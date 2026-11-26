"use client";

import { useCallback } from "react";
import { useInvalidateMatching } from "~/lib/swr";
import { timeTrackingKeys } from "~/lib/swr/portal-keys";

type OwnTimeChange = "time" | "leave" | "assignments";

/** Both a local write and its post-commit SSE echo enter this burst. */
export function useOwnTimeRefresh() {
  const invalidate = useInvalidateMatching();
  return useCallback(
    (change: OwnTimeChange) =>
      invalidate(
        (key) => {
          if (key.startsWith(timeTrackingKeys.overviewFamily)) return true;
          if (
            change !== "assignments" &&
            key.startsWith(timeTrackingKeys.periodFamily)
          )
            return true;
          return (
            change === "leave" &&
            (key.startsWith(timeTrackingKeys.leaveOverviewFamily) ||
              key.startsWith("time-tracking-absences-"))
          );
        },
        { expireInactive: true, coalesce: "own-time-tracking" },
      ),
    [invalidate],
  );
}
