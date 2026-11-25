import { TenantRouteSeed } from "../tenant-route-seed";
import { readContract, seedRead } from "~/lib/server-seed.server";
import { routes } from "~/lib/contract/timetable.generated";
import { hasPermission } from "~/lib/auth-utils";
import { databaseKeys } from "~/lib/swr/portal-keys";
import { closingDayKeys } from "~/lib/swr/staff-keys";
import { mapPeriods } from "~/lib/calendar-period-helpers";
import { mapClosingDays } from "~/lib/closing-day-helpers";
import PageContent from "./page-content";

export default async function CalendarPeriodsPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  return (
    <TenantRouteSeed
      slug={tenant}
      load={({ token, session }) => {
        if (
          !hasPermission(session, "schedules:manage") ||
          !hasPermission(session, "schedules:read")
        )
          return [];
        return [
          {
            key: databaseKeys.calendarPeriods(),
            render: true,
            value: seedRead("GET /api/timetable/periods/", async (signal) => {
              const { data } = await readContract(
                routes["GET /api/timetable/periods/"],
                { token, signal },
              );
              return mapPeriods(data);
            }),
          },
          {
            key: closingDayKeys.list(),
            value: seedRead(
              "GET /api/timetable/closing-days/",
              async (signal) => {
                const { data } = await readContract(
                  routes["GET /api/timetable/closing-days/"],
                  { token, signal },
                );
                return mapClosingDays(data);
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
