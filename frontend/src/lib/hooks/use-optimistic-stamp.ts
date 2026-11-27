"use client";

import { useRef } from "react";
import type { ClockSession } from "~/lib/own-time-tracking-view";
import {
  useOptimisticAction,
  type OptimisticOutcome,
} from "~/lib/swr/optimistic";
import { timeTrackingKeys } from "~/lib/swr/portal-keys";
import { STAMP_REFUSALS } from "~/lib/everyday-action-refusals";
import { noteCheckInRefusal } from "~/lib/hooks/check-in-lock";
import { timeTrackingService } from "~/lib/time-tracking-api";
import type { WorkSession } from "~/lib/time-tracking-helpers";

/** Both normal stamps and the reason-dialog retry use the same locked write. */
export function useOptimisticStamp(
  confirmed: ClockSession | null | undefined,
  commit: (session: WorkSession | null) => void,
  today: string,
) {
  const action = useOptimisticAction(
    timeTrackingKeys.overview(today),
    confirmed,
  );
  const inFlight = useRef(false);
  const stamp = async (
    status: WorkSession["status"] | null,
    reason?: string,
  ): Promise<OptimisticOutcome<WorkSession>> => {
    if (inFlight.current || confirmed === undefined)
      return { status: "discarded" };
    inFlight.current = true;
    const startedAt = Date.now();
    const now = new Date(startedAt).toISOString(); // Instant only, never a calendar date.
    try {
      const outcome = await action.run({
        optimistic: (current, { id }) =>
          status === null
            ? current && { ...current, checkOutTime: now }
            : {
                id,
                date: today,
                status,
                source: "app",
                checkInTime: now,
                checkOutTime: null,
                breakMinutes: 0,
                notes: "",
                autoCheckedOut: false,
              },
        request: () =>
          status === null
            ? reason === undefined
              ? timeTrackingService.checkOut()
              : timeTrackingService.checkOut(reason)
            : reason === undefined
              ? timeTrackingService.checkIn(status)
              : timeTrackingService.checkIn(status, reason),
        commit: (saved) => {
          // The current-session reader contains only an active work block.
          commit(status === null ? null : saved);
        },
        refusal: {
          codes: STAMP_REFUSALS,
          // Every own time-tracking read needs the refused permission. The
          // config stays readable with time_tracking:manage alone.
          matches: (key) =>
            key.startsWith("time-tracking-") && key !== "time-tracking-config",
        },
      });
      // „Einstempeln erst kurz vor Schichtbeginn“: Die Ablehnung nennt, ab
      // wann es heute geht; jeder Einstempel-Knopf sperrt sich bis dahin.
      if (status !== null && outcome.status === "failed")
        noteCheckInRefusal(outcome.error, today);
      return outcome;
    } finally {
      inFlight.current = false;
    }
  };
  return { ...action, stamp };
}
