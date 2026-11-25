import { ApiError } from "~/lib/api-error";
import type { OwnLeaveOverview } from "~/lib/contract/time-tracking.generated";
import { mapOwnAbsence } from "~/lib/own-time-tracking-view";

export function mapOwnLeave(overview: OwnLeaveOverview, year: number) {
  if (overview.year !== year) {
    throw new ApiError("Own leave year changed", undefined, {
      code: "general.unavailable",
    });
  }
  return {
    ...overview,
    recent: (overview.recent ?? []).map(mapOwnAbsence),
    questions: (overview.questions ?? []).map(mapOwnAbsence),
  };
}
