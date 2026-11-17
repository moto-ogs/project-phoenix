"use client";

import { useEffect } from "react";
import { ApiError } from "~/lib/api-error";
import { remainingRateLimitMs } from "~/lib/rate-limit-backoff";

/** SWR stops interval reads while an error remains, even after retries end. */
export function useSwrPollingRecovery(
  error: unknown,
  reload: () => Promise<unknown>,
  interval: number,
) {
  useEffect(() => {
    if (
      !error ||
      (error instanceof ApiError &&
        error.status !== undefined &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 429)
    )
      return;
    const timer = setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        remainingRateLimitMs("GET") === 0
      )
        void reload();
    }, interval);
    return () => clearInterval(timer);
  }, [error, interval, reload]);
}
