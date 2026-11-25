"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { berlinTodayISO } from "~/lib/date-helpers";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import type {
  FamilyFieldFailure,
  ParentFamily,
} from "~/lib/parent-family-cards";
import { ApiError } from "~/lib/api-error";
import { useSWRAuth, useInvalidateMatching } from "~/lib/swr";
import { useDiscardRefusedEntity } from "~/lib/swr/hooks";
import { parentKeys } from "~/lib/swr/parent-keys";
import {
  narrowNextFamilyRead,
  readParentFamily,
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

// A failed payload field is retried with backoff. Do not turn a client
// error or a server-imposed wait into an automatic one-second retry.
function canRetryField(failure?: FamilyFieldFailure) {
  if (!failure) return false;
  if (!(failure instanceof ApiError)) return true;
  return (failure.status ?? 0) >= 500 && !failure.retryAfterSeconds;
}

function partialChildren(family: ParentFamily): string {
  return family.children
    .map((child) => child.student_id)
    .filter(
      (id) =>
        canRetryField(family.featureErrors[id]) ||
        canRetryField(family.todayErrors[id]),
    )
    .sort()
    .join(",");
}

/** Mounted once in the authenticated shell; the standard scope boundary owns logout. */
export function useParentResourceEvents() {
  const invalidate = useInvalidateMatching();
  const refuse = useParentRefusal();
  const { data: session } = useSession();
  const account =
    session?.user.scope === "parent" ? session.user.id : undefined;
  const family = useParentFamily(!!account);

  // Commit an authoritative removal first. If this event discovered midnight,
  // a failed roster refresh must not restore yesterday's card or capabilities.
  const refreshDay = family.data?.needsDayReconciliation
    ? family.data.day
    : null;
  const reloadFamily = family.mutate;
  // A fast or slow device may not roll its cache key at server midnight.
  // If its key is already rolling, the new key itself starts that read.
  const keyDay = family.keyDay;
  const dayExpiry = family.data?.dayExpiry;
  useEffect(() => {
    if (!dayExpiry) return;
    // A seed was stamped by Next, not by this device. A slow device must
    // not add its clock skew to the lifetime reported by Go.
    const timer = window.setTimeout(
      () => {
        if (berlinTodayISO() === keyDay) void reloadFamily();
      },
      Math.max(0, Math.min(dayExpiry.at - Date.now(), dayExpiry.remainingMs)),
    );
    return () => window.clearTimeout(timer);
  }, [dayExpiry, keyDay, reloadFamily]);
  useEffect(() => {
    if (refreshDay) void reloadFamily();
  }, [refreshDay, reloadFamily]);

  const current = useRef(family);
  useLayoutEffect(() => {
    current.current = family;
  });
  // A 200 response can contain a failed card. SWR retries transport errors
  // itself; retry only the missing fields' owner(s) here, in the single bridge.
  const failedChildren = family.data ? partialChildren(family.data) : "";
  useEffect(() => {
    if (!failedChildren) return;
    let stopped = false;
    let timer: number;
    const retryAfter = (ms: number) => {
      timer = window.setTimeout(() => {
        const reader = current.current;
        const snapshot = reader.readCurrent?.();
        if (
          !snapshot?.data ||
          snapshot.error ||
          partialChildren(snapshot.data) !== failedChildren
        )
          return;
        if (!failedChildren.includes(","))
          narrowNextFamilyRead(snapshot.data, failedChildren);
        void reader.mutate().then(() => {
          if (!stopped && ms === 1000) retryAfter(2000);
        });
      }, ms);
    };
    retryAfter(1000);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [account, keyDay, failedChildren]);
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
    // An empty cache entry during a day-key switch is not a confirmed roster.
    if (before.account === account && relationships === null) return;
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
      readParentFamily(resource.readCurrent?.().data),
    {
      ...PARENT_RESOURCE_OPTIONS,
      revalidateIfStale: false,
      keepPreviousData: keepRosterAcrossMidnight,
      onError: (error) => {
        refuse(error);
      },
    },
  );
  return { ...resource, keyDay: day };
}

export function useParentChildren(enabled = true) {
  const family = useParentFamily(enabled, true);
  return { ...family, data: enabled ? family.data?.children : undefined };
}

const unavailable = new ApiError("Family start data unavailable", 503, {
  code: "general.unavailable",
});
function fieldError(failure?: FamilyFieldFailure) {
  if (!failure) return undefined;
  return failure instanceof ApiError ? failure : unavailable;
}

export function useParentFeatures(
  children: readonly parentMeContract.ChildResponse[] | undefined,
) {
  const family = useParentFamily(children !== undefined);
  const errorsByChild = Object.fromEntries(
    Object.entries(family.data?.featureErrors ?? {}).map(
      ([id, failure]) => [id, fieldError(failure)] as const,
    ),
  );
  return {
    ...family,
    data: family.data?.features,
    hasConfirmedData:
      family.data !== undefined &&
      family.data.children.every(
        (child) => !!family.data?.features[child.student_id],
      ),
    familyError: family.error,
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
      family.data.children.every(
        (child) => family.data?.confirmedToday[child.student_id],
      ),
    error:
      family.error ??
      fieldError(Object.values(family.data?.todayErrors ?? {})[0]),
  };
}
