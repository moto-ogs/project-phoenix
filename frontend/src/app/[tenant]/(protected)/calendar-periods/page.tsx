import { connection } from "next/server";
import { TenantRouteSeed } from "../tenant-route-seed";
import { readContract, seedRead } from "~/lib/server-seed.server";
import { routes } from "~/lib/contract/timetable.generated";
import { hasPermission } from "~/lib/auth-utils";
import { databaseKeys, timetableKeys } from "~/lib/swr/portal-keys";
import { closingDayKeys } from "~/lib/swr/staff-keys";
import { tenantDailyKeys } from "~/lib/swr/tenant-daily-keys";
import type { ServerSeedEntry } from "~/lib/swr/server-seed";
import { holidayWindow, mapPeriods } from "~/lib/calendar-period-helpers";
import { mapClosingDays } from "~/lib/closing-day-helpers";
import { berlinTodayISO } from "~/lib/date-helpers";
import {
  holidayWindows,
  mapSchoolHolidays,
  mergeSchoolHolidayWindows,
} from "~/lib/school-holidays-api";
import {
  mapSchoolVacationHints,
  mapSchoolVacations,
} from "~/lib/school-vacations-api";
import PageContent from "./page-content";

export default async function CalendarPeriodsPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  await connection();
  const today = berlinTodayISO();
  return (
    <TenantRouteSeed
      slug={tenant}
      claims={[
        timetableKeys.schoolVacationHints(today),
        closingDayKeys.list(),
        databaseKeys.calendarPeriods(),
      ]}
      load={async ({ token, session }) => {
        if (!hasPermission(session, "schedules:manage")) return [];
        const entries: ServerSeedEntry[] = [
          {
            key: timetableKeys.schoolVacationHints(today),
            value: seedRead("school vacation hints", async (signal) =>
              mapSchoolVacationHints(
                (
                  await readContract(
                    routes["GET /api/timetable/school-vacation-hints"],
                    { token, signal },
                  )
                ).data,
              ),
            ),
          },
        ];

        const canReadSchedules = hasPermission(session, "schedules:read");
        if (canReadSchedules) {
          entries.push({
            key: closingDayKeys.list(),
            value: seedRead("school closing days", async (signal) =>
              mapClosingDays(
                (
                  await readContract(
                    routes["GET /api/timetable/closing-days/"],
                    { token, signal },
                  )
                ).data,
              ),
            ),
          });
        }

        if (
          !canReadSchedules &&
          !hasPermission(session, "time_tracking:manage")
        )
          return entries;
        const periods = seedRead("calendar periods", async (signal) =>
          mapPeriods(
            (
              await readContract(routes["GET /api/timetable/periods/"], {
                token,
                signal,
              })
            ).data,
          ),
        );
        entries.push({
          key: databaseKeys.calendarPeriods(),
          render: true,
          value: periods,
        });

        if (!canReadSchedules && !hasPermission(session, "calendar:own"))
          return entries;
        // Both calendars use the actual current period, not a guessed week.
        const loadedPeriods = await periods;
        if (!loadedPeriods) return entries;
        const { from, to } = holidayWindow(loadedPeriods, today);
        entries.push(
          {
            key: tenantDailyKeys.schoolHolidays(from, to),
            value: seedRead("school holidays", async (signal) => {
              const windows = await Promise.all(
                holidayWindows(from, to).map(async (query) =>
                  mapSchoolHolidays(
                    (
                      await readContract(
                        routes["GET /api/timetable/holidays"],
                        { token, signal, query },
                      )
                    ).data,
                  ),
                ),
              );
              return mergeSchoolHolidayWindows(windows);
            }),
          },
          {
            key: timetableKeys.schoolVacations(from, to),
            value: seedRead("school vacations", async (signal) =>
              mapSchoolVacations(
                (
                  await readContract(
                    routes["GET /api/timetable/school-vacations"],
                    { token, signal, query: { from, to } },
                  )
                ).data,
              ),
            ),
          },
        );
        return entries;
      }}
    >
      <PageContent />
    </TenantRouteSeed>
  );
}
