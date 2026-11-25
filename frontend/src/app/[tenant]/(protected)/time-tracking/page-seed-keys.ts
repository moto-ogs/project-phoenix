import { parseISODate, toISODate } from "~/lib/date-helpers";
import { startOfWeek } from "~/lib/staff-metrics-helpers";
import { timeTrackingKeys } from "~/lib/swr/portal-keys";

export function ownTimeSeedKeys(today: string) {
  const start = toISODate(startOfWeek(parseISODate(today)));
  const year = Number(today.slice(0, 4));
  return {
    start,
    year,
    overview: timeTrackingKeys.overview(today),
    period: timeTrackingKeys.period("week", start),
    leave: timeTrackingKeys.leaveOverview(year),
  };
}
