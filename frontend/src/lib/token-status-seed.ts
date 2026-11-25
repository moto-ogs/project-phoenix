"use client";

import { useLayoutEffect, useState, useSyncExternalStore } from "react";
import type { FormattedChangeRequestDiffGroup } from "~/lib/enrollment-change-request-diff";
import type {
  EnrollmentChangeRequest,
  EnrollmentStatusDisplay,
} from "~/lib/enrollment-submission-api";

export interface TokenStatusSeed<T> {
  readonly builtAt: number;
  readonly data: T;
}

export type EnrollmentStatusChangeRequest = Pick<
  EnrollmentChangeRequest,
  | "id"
  | "origin"
  | "status"
  | "parent_note"
  | "admin_decision_note"
  | "created_at"
> & {
  readonly messages?: readonly Pick<
    NonNullable<EnrollmentChangeRequest["messages"]>[number],
    "id" | "author_type" | "body" | "created_at"
  >[];
  readonly groups: readonly FormattedChangeRequestDiffGroup[];
};

export interface EnrollmentStatusSeedData {
  readonly status: EnrollmentStatusDisplay;
  readonly changes?: readonly EnrollmentStatusChangeRequest[];
  readonly changesLocale?: string;
}

const MAX_AGE_MS = 30_000;
// Record that an opening used this particular RSC payload, not its data or
// token. A remount from the Router Cache needs a new capability check.
const opened = new WeakSet<object>();
const subscribeNothing = () => () => {};

function isFresh(seed: TokenStatusSeed<unknown>): boolean {
  return Math.abs(Date.now() - seed.builtAt) <= MAX_AGE_MS;
}

export function useTokenStatusSeed<T>(initial: TokenStatusSeed<T> | undefined) {
  const hydrating = useSyncExternalStore(
    subscribeNothing,
    () => false,
    () => true,
  );
  const [seed] = useState(() =>
    initial && !opened.has(initial) && (hydrating || isFresh(initial))
      ? initial
      : undefined,
  );
  const [discarded, discard] = useState(false);
  useLayoutEffect(() => {
    if (!seed || typeof window === "undefined") return;
    opened.add(seed);
    if (!isFresh(seed)) discard(true);
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) discard(true);
    };
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, [seed]);
  return discarded ? undefined : seed?.data;
}
