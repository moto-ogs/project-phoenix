"use client";

import { useState } from "react";
import { useSWRAuth } from "~/lib/swr";
import { useSwrPollingRecovery } from "./use-swr-polling-recovery";

export const MAIL_RECONCILE_MS = 5 * 60_000;

/** Reschedule immediately on a new answer, including a refresh after a write. */
export function useMailStatusRead<T>(
  key: string | null,
  read: () => Promise<T>,
  intervalFor: (data: T) => number,
  recoveryMs: number,
) {
  const [interval, setIntervalMs] = useState(0);
  const result = useSWRAuth(key, read, {
    keepPreviousData: false,
    revalidateOnFocus: true,
    dedupingInterval: 0,
    refreshInterval: interval,
  });
  const next =
    result.data === undefined || result.error ? 0 : intervalFor(result.data);
  if (interval !== next) setIntervalMs(next);
  useSwrPollingRecovery(result.error, result.mutate, recoveryMs);
  return result;
}
