import { TenantRouteSeed } from "../tenant-route-seed";
import { readContract, seedRead } from "~/lib/server-seed.server";
import { routes } from "~/lib/contract/timetable.generated";
import { hasPermission } from "~/lib/auth-utils";
import { berlinTodayISO, isValidISODate } from "~/lib/date-helpers";
import { mapPlannedInstance } from "~/lib/timetable-operations-types";
import { tenantDailyKeys } from "~/lib/swr/tenant-daily-keys";
import PageContent from "./page-content";

export const unstable_dynamicStaleTime = 60;

export default async function TagesplanPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ d?: string | string[] }>;
}) {
  const { tenant } = await params;
  const { d } = await searchParams;
  return (
    <TenantRouteSeed
      slug={tenant}
      load={({ token, session, tenant: school }) => {
        if (
          school.presenceMode === "binary" ||
          school.timetableEnabled === false ||
          !hasPermission(session, "schedules:read")
        )
          return [];
        const requested = Array.isArray(d) ? d[0] : d;
        const day =
          requested && isValidISODate(requested) ? requested : berlinTodayISO();
        return [
          {
            key: tenantDailyKeys.dayPlan(day),
            render: true,
            value: seedRead(
              "GET /api/timetable/operations/planned-now",
              async (signal) => {
                const { data } = await readContract(
                  routes["GET /api/timetable/operations/planned-now"],
                  { token, signal, query: { date: day, scope: "day" } },
                );
                return (data.instances ?? []).map(mapPlannedInstance);
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
