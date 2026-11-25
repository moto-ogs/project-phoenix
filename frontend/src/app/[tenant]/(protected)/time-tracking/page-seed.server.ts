import { hasPermission } from "~/lib/auth-utils";
import * as timeTracking from "~/lib/contract/time-tracking.generated";
import { berlinTodayISO } from "~/lib/date-helpers";
import { mapOwnLeave } from "~/lib/own-leave-resource";
import { readContract, seedOf, seedRead } from "~/lib/server-seed.server";
import { readTenantPageContext } from "~/lib/tenant-page-seed.server";
import { mapOwnClock } from "./own-clock-read";
import { mapOwnPeriod } from "./own-period-read";
import { ownTimeSeedKeys } from "./page-seed-keys";

export async function loadTimeTrackingSeed(slug: string) {
  const builtAt = Date.now();
  const context = await readTenantPageContext(slug, "zeiterfassung");
  if (!context || !hasPermission(context.session, "time_tracking:own"))
    return null;

  const { snapshot, token } = context;
  const today = berlinTodayISO();
  const { start, year, overview, period, leave } = ownTimeSeedKeys(today);

  return seedOf(
    snapshot,
    [
      {
        key: overview,
        render: true,
        value: seedRead("ownClockOverview", async (signal) =>
          mapOwnClock(
            (
              await readContract(
                timeTracking.routes["GET /api/time-tracking/overview"],
                { token, signal },
              )
            ).data,
            today,
          ),
        ),
      },
      {
        key: period,
        value: seedRead("ownTimePeriod", async (signal) =>
          mapOwnPeriod(
            (
              await readContract(
                timeTracking.routes["GET /api/time-tracking/period"],
                {
                  token,
                  signal,
                  query: { view: "week", start },
                },
              )
            ).data,
            "week",
            start,
          ),
        ),
      },
      {
        key: leave,
        value: seedRead("ownLeaveOverview", async (signal) =>
          mapOwnLeave(
            (
              await readContract(
                timeTracking.routes["GET /api/time-tracking/leave-overview"],
                { token, signal },
              )
            ).data,
            year,
          ),
        ),
      },
    ],
    builtAt,
  );
}
