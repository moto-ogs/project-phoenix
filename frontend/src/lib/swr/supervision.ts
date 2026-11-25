"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo } from "react";
import { ApiError, isSessionRefusalCode } from "~/lib/api-error";
import { isReadRefusal } from "~/lib/access-refusal";
import { bffJson } from "~/lib/bff-fetch";
import type { NavigationContext } from "~/lib/contract/active.generated";
import { errorLogFields } from "~/lib/error-log";
import { useLatest } from "~/lib/hooks/use-latest";
import { createLogger } from "~/lib/logger";
import { isStillCurrent, startOf, type SWRStart } from "./generation";
import { useScopedSWRKey, useSWRAuth } from "./hooks";
import { useLiveRefreshInterval } from "./live-sync";
import { isSWRSessionPending } from "./scope";
import { supervisionContextKeys } from "./supervision-keys";

const logger = createLogger({ component: "StaffSupervisionContext" });
const ALL_SECTIONS = ["groups", "released-rooms", "sessions"] as const;
export type SupervisionSection = (typeof ALL_SECTIONS)[number];

export type RefreshSupervision = (
  sections?: readonly SupervisionSection[],
  reason?: "reconcile",
) => Promise<void>;

interface Batch {
  sections: Set<SupervisionSection>;
  done: Promise<void>;
  resolve: () => void;
}

function newBatch(): Batch {
  let resolve: () => void = () => undefined;
  const done = new Promise<void>((finish) => {
    resolve = finish;
  });
  return { sections: new Set(), done, resolve };
}

const UNAVAILABLE_GROUPS: NonNullable<NavigationContext["groups"]> = {
  status: "unavailable",
  navigation: null,
  own_group_ids: null,
  own_room_names: null,
};
const UNAVAILABLE_ROOMS: NonNullable<NavigationContext["released_rooms"]> = {
  status: "unavailable",
  items: null,
};
const UNAVAILABLE_SESSIONS: NonNullable<NavigationContext["sessions"]> = {
  status: "unavailable",
  overview_status: "unavailable",
  own_status: "unavailable",
  items: null,
};

async function loadSections(
  sections: readonly SupervisionSection[],
  hasBaseline: boolean,
): Promise<NavigationContext> {
  let answer: NavigationContext;
  try {
    answer = await bffJson(
      "tenant",
      "GET /api/active/supervision-context",
      sections.length === ALL_SECTIONS.length
        ? undefined
        : { query: { section: [...sections] } },
    );
  } catch (error) {
    // SWR must only lift a refusal after an actual answer. With no readable
    // baseline, expose the request error rather than caching placeholders.
    if (
      !hasBaseline ||
      isReadRefusal(error) ||
      (error instanceof ApiError && isSessionRefusalCode(error.code))
    )
      throw error;
    logger.warn("supervision_context_read_failed", {
      ...errorLogFields(error),
      sections,
    });
    answer = {};
  }
  // A missing requested section is a failure, not an earlier value the
  // client can keep displaying. Take nothing for unrequested sections.
  return {
    ...(sections.includes("groups") && {
      groups: answer.groups ?? UNAVAILABLE_GROUPS,
    }),
    ...(sections.includes("released-rooms") && {
      released_rooms: answer.released_rooms ?? UNAVAILABLE_ROOMS,
    }),
    ...(sections.includes("sessions") && {
      sessions: answer.sessions ?? UNAVAILABLE_SESSIONS,
    }),
  };
}

/**
 * Only request metadata is held here; the merge base is always the scoped SWR
 * entry. One trailing batch covers writes and events that arrived after the
 * current request started. A recovery/poll can share an in-flight full read.
 */
class SupervisionReads {
  private mounted = true;
  private active?: {
    start: SWRStart;
    batch: Batch;
    answer: Promise<NavigationContext>;
    full: boolean;
  };
  private pending?: Batch;
  private revalidate?: () => Promise<unknown>;
  private lastFullAt?: number;

  constructor(private readonly key: string | null) {}

  pause() {
    this.mounted = false;
    queueMicrotask(() => {
      if (this.mounted) return; // Strict Mode's effect replay.
      this.pending?.resolve();
      this.pending = undefined;
      this.active?.batch.resolve();
      this.active = undefined;
    });
  }

  resume() {
    this.mounted = true;
  }

  request(
    sections: readonly SupervisionSection[],
    revalidate: () => Promise<unknown>,
    reconcile: boolean,
  ) {
    const key = this.key;
    if (!this.mounted || !key || isSWRSessionPending())
      return Promise.resolve();
    if (reconcile && !this.pending) {
      if (this.active?.full && isStillCurrent(key, this.active.start))
        return this.active.batch.done;
      if (
        !this.active &&
        this.lastFullAt !== undefined &&
        Date.now() - this.lastFullAt < 1_000
      )
        return Promise.resolve();
    }
    this.revalidate = revalidate;
    const pending = (this.pending ??= newBatch());
    for (const section of sections) pending.sections.add(section);
    queueMicrotask(this.drain);
    return pending.done;
  }

  read(previous: NavigationContext | undefined): Promise<NavigationContext> {
    const key = this.key;
    if (key === null) throw new Error("Supervision read without a scope");
    if (this.active) {
      if (isStillCurrent(key, this.active.start)) return this.active.answer;
      this.active.batch.resolve();
    }

    const batch = this.pending ?? newBatch();
    this.pending = undefined;
    // Without a complete baseline, a partial answer cannot initialize the key.
    const sections =
      previous && batch.sections.size
        ? ALL_SECTIONS.filter((section) => batch.sections.has(section))
        : ALL_SECTIONS;
    const active = {
      start: startOf(key),
      batch,
      answer: loadSections(sections, previous !== undefined).then((answer) => ({
        ...previous,
        ...answer,
      })),
      full: sections.length === ALL_SECTIONS.length,
    };
    this.active = active;
    const settle = () => {
      // SWR can discard a read (e.g. a concurrent shell seed or refusal
      // eviction) without calling onSuccess or onError. Release the queue
      // once the fetch settles, after SWR has had its turn to store it.
      setTimeout(() => {
        if (this.active !== active) return;
        this.active = undefined;
        if (active.full && isStillCurrent(key, active.start))
          this.lastFullAt = Date.now();
        active.batch.resolve();
        this.drain();
      }, 0);
    };
    void active.answer.then(settle, settle);
    return active.answer;
  }

  private drain = () => {
    const { pending, active, revalidate } = this;
    if (!this.mounted || !pending || active || !revalidate) return;
    // A generation drop can stop the bound mutate before it starts a read.
    const skipped = () => {
      if (this.pending !== pending) return;
      this.pending = undefined;
      pending.resolve();
    };
    void revalidate().then(skipped, skipped);
  };
}

export function useSupervisionSnapshot(
  enabled: boolean,
  binding: string | null,
) {
  const key = enabled ? supervisionContextKeys.snapshot() : null;
  const scoped = useScopedSWRKey(supervisionContextKeys.snapshot());
  const scopedKey = enabled ? scoped : null;
  const queue = useMemo(
    () => new SupervisionReads(binding ? scopedKey : null),
    [binding, scopedKey],
  );
  const readCurrent = useLatest<
    (() => NavigationContext | undefined) | undefined
  >(undefined);
  const read = useSWRAuth(key, () => queue.read(readCurrent.current?.()), {
    keepPreviousData: false,
    revalidateIfStale: false,
    revalidateOnReconnect: false,
    shouldRetryOnError: false,
  });
  useLayoutEffect(() => {
    readCurrent.current = () => read.readCurrent?.().data;
  }, [read, readCurrent]);
  useLayoutEffect(() => {
    queue.resume();
    return () => queue.pause();
  }, [queue]);
  const refresh: RefreshSupervision = useCallback(
    (sections = ALL_SECTIONS, reason) =>
      queue.request(sections, read.mutate, reason === "reconcile"),
    [queue, read.mutate],
  );
  const interval = useLiveRefreshInterval(5 * 60_000);
  useEffect(() => {
    if (scopedKey === null) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        void refresh(ALL_SECTIONS, "reconcile");
    }, interval);
    return () => clearInterval(timer);
  }, [interval, refresh, scopedKey]);

  return { ...read, refresh };
}
