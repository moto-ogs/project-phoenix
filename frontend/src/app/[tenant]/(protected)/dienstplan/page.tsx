import { staffDirectorySeed } from "~/lib/staff-directory-seed.server";
import { TenantRouteSeed } from "../tenant-route-seed";
import { readContract, seedRead } from "~/lib/server-seed.server";
import * as contract from "~/lib/contract/staff-shifts.generated";
import * as timetable from "~/lib/contract/timetable.generated";
import * as timeTracking from "~/lib/contract/time-tracking.generated";
import * as shiftTypes from "~/lib/contract/shift-types.generated";
import { hasPermission } from "~/lib/auth-utils";
import { berlinTodayISO, isValidISODate } from "~/lib/date-helpers";
import { calendarWeekDays } from "~/lib/own-dienstplan-helpers";
import { mapStaffScheduleOverview, mapStaffShift } from "~/lib/shift-helpers";
import { mapShiftType } from "~/lib/shift-type-helpers";
import { mapPeriods } from "~/lib/calendar-period-helpers";
import { mapClosingDays } from "~/lib/closing-day-helpers";
import { mapClosingDaysResponse } from "~/lib/time-tracking-helpers";
import { databaseKeys } from "~/lib/swr/portal-keys";
import { closingDayKeys } from "~/lib/swr/staff-keys";
import { tenantDailyKeys } from "~/lib/swr/tenant-daily-keys";
import PageContent from "./page-content";

export default async function DienstplanPage({
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
      load={({ token, session }) => {
        if (!hasPermission(session, "time_tracking:manage")) return [];
        const days = calendarWeekDays(day);
        const from = days[0] ?? "";
        const to = days[4] ?? "";
        const canReadSchedules = hasPermission(session, "schedules:read");
        const full = canReadSchedules && hasPermission(session, "users:read");
        const canReadStaff =
          hasPermission(session, "users:read") ||
          hasPermission(session, "staff:manage") ||
          hasPermission(session, "staff:stammdaten");
        return [
          canReadSchedules
            ? {
                key: closingDayKeys.list(),
                value: seedRead("school closing days", async (signal) =>
                  mapClosingDays(
                    (
                      await readContract(
                        timetable.routes["GET /api/timetable/closing-days/"],
                        { token, signal },
                      )
                    ).data,
                  ),
                ),
              }
            : {
                key: closingDayKeys.window(from, to),
                value: seedRead("rota closing days", async (signal) =>
                  mapClosingDaysResponse(
                    (
                      await readContract(
                        timeTracking.routes[
                          "GET /api/time-tracking/closing-days"
                        ],
                        {
                          token,
                          signal,
                          query: { from, to },
                        },
                      )
                    ).data,
                    from,
                    to,
                  ),
                ),
              },
          {
            key: databaseKeys.calendarPeriods(),
            value: seedRead("GET /api/timetable/periods/", async (signal) => {
              const { data } = await readContract(
                timetable.routes["GET /api/timetable/periods/"],
                { token, signal },
              );
              return mapPeriods(data);
            }),
          },
          {
            key: tenantDailyKeys.shiftTypes(),
            value: seedRead("GET /api/shift-types/", async (signal) => {
              const { data } = await readContract(
                shiftTypes.routes["GET /api/shift-types/"],
                { token, signal, query: { include_archived: true } },
              );
              return data.map(mapShiftType);
            }),
          },
          ...(full
            ? [
                {
                  key: tenantDailyKeys.dienstplanOverview(from, to),
                  render: true,
                  value: seedRead(
                    "GET /api/staff-shifts/overview",
                    async (signal) => {
                      const { data } = await readContract(
                        contract.routes["GET /api/staff-shifts/overview"],
                        { token, signal, query: { from, to } },
                      );
                      return mapStaffScheduleOverview(data);
                    },
                  ),
                },
              ]
            : []),
          ...(!full
            ? [
                {
                  key: tenantDailyKeys.dienstplanShifts(from, to),
                  render: true,
                  value: seedRead("GET /api/staff-shifts/", async (signal) => {
                    const { data } = await readContract(
                      contract.routes["GET /api/staff-shifts/"],
                      { token, signal, query: { from, to } },
                    );
                    return (data ?? []).map(mapStaffShift);
                  }),
                },
              ]
            : []),
          ...(!full && canReadStaff
            ? [staffDirectorySeed(token, hasPermission(session, "groups:read"))]
            : []),
        ];
      }}
    >
      <PageContent />
    </TenantRouteSeed>
  );
}
