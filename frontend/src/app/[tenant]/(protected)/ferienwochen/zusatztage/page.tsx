import { TenantRouteSeed } from "../../tenant-route-seed";
import { hasPermission } from "~/lib/auth-utils";
import { routes } from "~/lib/contract/holiday-extra-days.generated";
import { readContract, seedRead } from "~/lib/server-seed.server";
import { holidayKeys } from "~/lib/swr/portal-keys";
import { holidayPeriodFromBackend } from "~/lib/traeger-api";
import PageContent from "./page-content";

export default async function SchoolExtraDaysPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  return (
    <TenantRouteSeed
      slug={tenant}
      claims={[holidayKeys.extraDays()]}
      load={async ({ token, session }) => {
        if (!hasPermission(session, "schedules:update")) return [];
        return [
          {
            key: holidayKeys.extraDays(),
            render: true,
            value: seedRead("schoolExtraDays", async (signal) => {
              const { data } = await readContract(
                routes["GET /api/holiday-extra-days/"],
                { token, signal },
              );
              return data.map(holidayPeriodFromBackend);
            }),
          },
        ];
      }}
    >
      <PageContent />
    </TenantRouteSeed>
  );
}
