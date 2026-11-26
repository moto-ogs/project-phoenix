import { TenantRouteSeed } from "../tenant-route-seed";
import { readContract, seedRead } from "~/lib/server-seed.server";
import * as contract from "~/lib/contract/calendar.generated";
import * as timetable from "~/lib/contract/timetable.generated";
import { hasPermission, isAdmin } from "~/lib/auth-utils";
import { berlinTodayISO, parseISODate, toISODate } from "~/lib/date-helpers";
import { getWeekRange } from "~/lib/timetable-helpers";
import { calendarResponse } from "~/lib/personal-calendar-api";
import { mapSchoolHolidays } from "~/lib/school-holidays-api";
import { tenantDailyKeys } from "~/lib/swr/tenant-daily-keys";
import { loadBetreuungsplanSeed } from "~/lib/betreuungsplan-seed.server";
import { SCHOOL_PLAN_PARAMS } from "./school-plan-params";
import PageContent from "./page-content";

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ tenant }, query] = await Promise.all([params, searchParams]);

  return (
    <TenantRouteSeed
      slug={tenant}
      load={async ({ token, session }) => {
        if (
          !isAdmin(session) &&
          hasPermission(session, "schedules:read") &&
          SCHOOL_PLAN_PARAMS.some((key) => query[key] !== undefined)
        ) {
          return (
            (await loadBetreuungsplanSeed(tenant, query).catch(() => null))
              ?.entries ?? []
          );
        }
        const weeks = getWeekRange(parseISODate(berlinTodayISO()));
        const from = toISODate(weeks.from);
        const to = toISODate(weeks.to);
        return [
          ...(hasPermission(session, "calendar:own")
            ? [
                {
                  key: tenantDailyKeys.staffCalendar("week", from, to),
                  render: true,
                  value: seedRead("GET /api/calendar/my", async (signal) => {
                    const { data } = await readContract(
                      contract.routes["GET /api/calendar/my"],
                      { token, signal, query: { from, to } },
                    );
                    return calendarResponse(data);
                  }),
                },
              ]
            : []),
          ...(hasPermission(session, "calendar:own") ||
          hasPermission(session, "schedules:read")
            ? [
                {
                  key: tenantDailyKeys.schoolHolidays(from, to),
                  value: seedRead(
                    "GET /api/timetable/holidays",
                    async (signal) => {
                      const { data } = await readContract(
                        timetable.routes["GET /api/timetable/holidays"],
                        { token, signal, query: { from, to } },
                      );
                      return mapSchoolHolidays(data);
                    },
                  ),
                },
              ]
            : []),
        ];
      }}
    >
      <PageContent />
    </TenantRouteSeed>
  );
}
