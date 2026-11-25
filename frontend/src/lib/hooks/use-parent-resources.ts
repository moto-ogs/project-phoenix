"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { ApiError } from "~/lib/api-error";
import { useSWRAuth, useInvalidateMatching } from "~/lib/swr";
import { useDiscardRefusedEntity } from "~/lib/swr/hooks";
import { parentKeys } from "~/lib/swr/parent-keys";
import {
  narrowNextFamilyRead,
  readParentFamily,
  type ParentFamily,
} from "~/lib/parent-family-start";

import {
  PARENT_ACCESS_REFUSAL_CODES as REFUSAL_CODES,
  isParentAccessRefusal,
  PARENT_ACCESS_REFUSED_EVENT,
} from "~/lib/parent-access-refusal";
import type * as parentMeContract from "~/lib/contract/parent-me.generated";
const REFUSAL_SIGNAL = "moto:parent-access-refused";
let tabSource: string | undefined;
const sourceOfTab = () => (tabSource ??= crypto.randomUUID());
export const PARENT_RESOURCE_OPTIONS = {
  keepPreviousData: false,
  revalidateOnFocus: true,
  focusThrottleInterval: 60_000,
  dedupingInterval: 60_000,
  revalidateIfStale: true,
} as const;

/** A refusal withdraws every derived page too, not only the endpoint's entry. */
function useParentRefusal() {
  const discard = useDiscardRefusedEntity();
  const invalidate = useInvalidateMatching();
  const { data: session } = useSession();
  const account =
    session?.user.scope === "parent" ? session.user.id : undefined;
  return useCallback(
    (error: unknown, broadcast = true) => {
      // Callers are the portal-access-only readers or already classified signals.
      if (!account || !isParentAccessRefusal(error, "GET", true)) return false;
      const refused = discard(error, {
        codes: REFUSAL_CODES,
        matches: parentKeys.isResource,
      });
      if (refused) void invalidate(parentKeys.isFamilyStart);
      if (refused && broadcast && account && error instanceof ApiError) {
        const channel = new BroadcastChannel(REFUSAL_SIGNAL);
        channel.postMessage({
          source: sourceOfTab(),
          account,
          code: error.code,
          status: error.status,
        });
        channel.close();
      }
      return refused;
    },
    [discard, invalidate, account],
  );
}

/** Mounted once in the authenticated shell; the standard scope boundary owns logout. */
export function useParentResourceEvents() {
  const invalidate = useInvalidateMatching();
  const refuse = useParentRefusal();
  const { data: session } = useSession();
  const account =
    session?.user.scope === "parent" ? session.user.id : undefined;
  const family = useParentFamily(!!account);

  const current = useRef(family);
  useLayoutEffect(() => {
    current.current = family;
  });
  const relationships = family.data
    ? JSON.stringify(
        Object.entries(family.data.accessVersions).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      )
    : null;
  const previous = useRef({ account, relationships });
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = { account, relationships };
    if (
      before.account === account &&
      before.relationships !== null &&
      relationships !== null &&
      before.relationships !== relationships
    ) {
      // A list can reveal a removed relationship without a refused endpoint.
      // Do not revive its old capabilities if that relationship is later added again.
      void invalidate(
        (key) => parentKeys.isResource(key) && !parentKeys.isFamilyStart(key),
        { clear: true },
      );
    }
  }, [account, relationships, invalidate]);
  useEffect(() => {
    const refreshChild = (event: Event) => {
      const studentId = (event as CustomEvent<{ studentId?: string | null }>)
        .detail?.studentId;
      // Also the child's state on pages not open now: returning to them
      // within the dedupe window would show the decision's old state.
      const reader = current.current;
      const known = reader.readCurrent?.().data;
      if (studentId && known) narrowNextFamilyRead(known, studentId);
      void reader.mutate();
      void invalidate((key) =>
        parentKeys.isChildStatusResource(key, studentId),
      );
    };
    const refreshMessages = () => {
      void invalidate(parentKeys.isMessagesResource);
    };
    const refreshNews = () => {
      void invalidate(parentKeys.isNewsResource);
    };
    const accessRefused = (event: Event) => {
      const detail = (
        event as CustomEvent<{ account?: string; error?: unknown }>
      ).detail;
      if (detail?.account === account) refuse(detail.error);
    };
    const channel = new BroadcastChannel(REFUSAL_SIGNAL);
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const signal = event.data;
      if (!signal || typeof signal !== "object") return;
      const {
        source,
        account: signalAccount,
        code,
        status,
      } = signal as Record<string, unknown>;
      if (source === sourceOfTab() || signalAccount !== account) return;
      if (
        (code === "care.child_not_linked" ||
          code === "care.guardian_permission_denied") &&
        (status === 401 || status === 403 || status === 404)
      ) {
        refuse(new ApiError(code, status, { code }), false);
      }
    };
    window.addEventListener("parent-child-status-refresh", refreshChild);
    window.addEventListener("parent-messages-unread-refresh", refreshMessages);
    window.addEventListener("parent-news-unread-refresh", refreshNews);
    window.addEventListener(PARENT_ACCESS_REFUSED_EVENT, accessRefused);
    return () => {
      window.removeEventListener("parent-child-status-refresh", refreshChild);
      window.removeEventListener(
        "parent-messages-unread-refresh",
        refreshMessages,
      );
      window.removeEventListener("parent-news-unread-refresh", refreshNews);
      channel.close();
      window.removeEventListener(PARENT_ACCESS_REFUSED_EVENT, accessRefused);
    };
  }, [invalidate, refuse, account]);
}

function useParentFamily(enabled: boolean, keepRosterAcrossMidnight = false) {
  const day = useBerlinToday();
  const { data: session } = useSession();
  const refuse = useParentRefusal();
  const resource = useSWRAuth<ParentFamily>(
    enabled && session?.user.scope === "parent"
      ? parentKeys.familyStart(day)
      : null,
    (): Promise<ParentFamily> =>
      readParentFamily(resource.readCurrent?.().data, day),
    {
      ...PARENT_RESOURCE_OPTIONS,
      revalidateIfStale: false,
      keepPreviousData: keepRosterAcrossMidnight,
      onError: (error) => {
        refuse(error);
      },
    },
  );
  return resource;
}

export function useParentChildren(enabled = true) {
  const family = useParentFamily(enabled, true);
  return { ...family, data: enabled ? family.data?.children : undefined };
}

const NO_FAILURES: Readonly<Record<string, Error>> = {};

export function useParentFeatures(
  children: readonly parentMeContract.ChildResponse[] | undefined,
) {
  const family = useParentFamily(children !== undefined);
  const errorsByChild = family.data?.featureErrors ?? NO_FAILURES;
  return {
    ...family,
    data: family.data?.features,
    hasConfirmedData:
      family.data !== undefined &&
      family.data.children.every(
        (child) => !!family.data?.features[child.student_id],
      ),
    error: family.error ?? Object.values(errorsByChild)[0],
    errorsByChild,
  };
}

export function useParentToday(
  children: readonly parentMeContract.ChildResponse[] | undefined,
) {
  const family = useParentFamily(children !== undefined);
  return {
    ...family,
    data: family.data?.today,
    hasConfirmedData:
      family.data !== undefined &&
      Object.values(family.data.confirmedToday).every(Boolean),
    error:
      family.error ?? Object.values(family.data?.todayErrors ?? NO_FAILURES)[0],
  };
}
