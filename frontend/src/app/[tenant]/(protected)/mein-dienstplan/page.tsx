import { TenantRouteSeed } from "../tenant-route-seed";
import { readContract, seedRead } from "~/lib/server-seed.server";
import * as contract from "~/lib/contract/time-tracking.generated";
import * as timetable from "~/lib/contract/timetable.generated";
import { hasPermission } from "~/lib/auth-utils";
import { berlinTodayISO, isValidISODate } from "~/lib/date-helpers";
import { calendarWeekDays, lookaheadRange } from "~/lib/own-dienstplan-helpers";
import { isScopeBooked } from "~/lib/module-register";
import { mapStaffShift } from "~/lib/shift-helpers";
import { mapClosingDays } from "~/lib/closing-day-helpers";
import {
  mapClosingDaysResponse,
  mapDailyProjectionResponse,
} from "~/lib/time-tracking-helpers";
import { closingDayKeys } from "~/lib/swr/staff-keys";
import { timeTrackingKeys } from "~/lib/swr/portal-keys";
import PageContent from "./page-content";

export default async function OwnDienstplanPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenant } = await params;
  const query = await searchParams;
  const d = Array.isArray(query.d) ? query.d[0] : query.d;
  const today = berlinTodayISO();
  const day = d && isValidISODate(d) ? d : today;
  return (
    <TenantRouteSeed
      slug={tenant}
      module="dienstplan"
      load={({ token, session, tenant: school }) => {
        if (!hasPermission(session, "time_tracking:own")) return [];
        const days = calendarWeekDays(day);
        const from = days[0] ?? "";
        const to = days[6] ?? "";
        const ahead = lookaheadRange(to);
        const readShifts = (query: { from: string; to: string }) =>
          seedRead("own shifts", async (signal) => {
            const { data } = await readContract(
              contract.routes["GET /api/time-tracking/shifts"],
              { token, signal, query },
            );
            return (data ?? []).map(mapStaffShift);
          });
        const week = readShifts({ from, to });
        return [
          {
            key: timeTrackingKeys.ownShiftsWeek(from, to),
            render: true,
            value: week,
          },
          {
            key: timeTrackingKeys.ownShiftsAhead(ahead.from, ahead.to),
            value: week.then((data) =>
              data?.length === 0 ? readShifts(ahead) : undefined,
            ),
          },
          ...(isScopeBooked("zeiterfassung", school.bookedModules)
            ? [
                {
                  key: timeTrackingKeys.scheduleTargets(from, to),
                  value: seedRead(
                    "GET /api/time-tracking/schedule-targets",
                    async (signal) => {
                      const { data } = await readContract(
                        contract.routes[
                          "GET /api/time-tracking/schedule-targets"
                        ],
                        { token, signal, query: { from, to } },
                      );
                      return mapDailyProjectionResponse(data);
                    },
                  ),
                },
              ]
            : []),
          hasPermission(session, "schedules:read")
            ? {
                key: closingDayKeys.list(),
                value: seedRead(
                  "GET /api/timetable/closing-days/",
                  async (signal) => {
                    const { data } = await readContract(
                      timetable.routes["GET /api/timetable/closing-days/"],
                      { token, signal },
                    );
                    return mapClosingDays(data);
                  },
                ),
              }
            : {
                key: closingDayKeys.window(from, to),
                value: seedRead(
                  "GET /api/time-tracking/closing-days",
                  async (signal) => {
                    const { data } = await readContract(
                      contract.routes["GET /api/time-tracking/closing-days"],
                      { token, signal, query: { from, to } },
                    );
                    return mapClosingDaysResponse(data, from, to);
                  },
                ),
              },
        ];
      }}
    >
      <PageContent />
    </TenantRouteSeed>
  );
}
