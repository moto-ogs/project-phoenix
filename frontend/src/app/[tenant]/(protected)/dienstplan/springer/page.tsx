import { TenantRouteSeed } from "../../tenant-route-seed";
import { readContract, seedRead } from "~/lib/server-seed.server";
import { routes } from "~/lib/contract/staff-pool.generated";
import { hasPermission } from "~/lib/auth-utils";
import { mondayOf } from "~/components/traeger/planning/planning-format";
import { berlinTodayISO } from "~/lib/date-helpers";
import { mapPoolWeek } from "~/lib/staff-pool-api";
import { tenantDailyKeys } from "~/lib/swr/tenant-daily-keys";
import PageContent from "./page-content";

export default async function StaffPoolPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  return (
    <TenantRouteSeed
      slug={tenant}
      module="dienstplan"
      load={({ token, session }) => {
        if (!hasPermission(session, "time_tracking:manage")) return [];
        const weekStart = mondayOf(berlinTodayISO());
        return [
          {
            key: tenantDailyKeys.springerWeek(weekStart),
            render: true,
            value: seedRead("GET /api/staff-pool/", async (signal) => {
              const { data } = await readContract(
                routes["GET /api/staff-pool/"],
                { token, signal, query: { week: weekStart } },
              );
              return mapPoolWeek(data);
            }),
          },
        ];
      }}
    >
      <PageContent />
    </TenantRouteSeed>
  );
}
