import { TenantRouteSeed } from "../tenant-route-seed";
import { readContract, seedRead } from "~/lib/server-seed.server";
import { routes } from "~/lib/contract/holiday-weeks.generated";
import { hasPermission } from "~/lib/auth-utils";
import { mapWeek } from "~/lib/holiday-host-api";
import { holidayKeys } from "~/lib/swr/portal-keys";
import PageContent from "./page-content";

export default async function FerienwochenPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  return (
    <TenantRouteSeed
      slug={tenant}
      load={({ token, session }) => {
        if (!hasPermission(session, "config:read")) return [];
        return [
          {
            key: holidayKeys.hostedWeeks(),
            render: true,
            value: seedRead("GET /api/holiday-weeks/", async (signal) => {
              const { data } = await readContract(
                routes["GET /api/holiday-weeks/"],
                { token, signal },
              );
              return data.map(mapWeek);
            }),
          },
        ];
      }}
    >
      <PageContent />
    </TenantRouteSeed>
  );
}
