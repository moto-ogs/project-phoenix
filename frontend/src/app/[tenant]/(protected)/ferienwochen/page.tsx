import { TenantRouteSeed } from "../tenant-route-seed";
import { readContract, seedRead } from "~/lib/server-seed.server";
import { routes } from "~/lib/contract/holiday-weeks.generated";
import { hasPermission } from "~/lib/auth-utils";
import { mapHolidayOwnChildAssignment, mapWeek } from "~/lib/holiday-host-api";
import { holidayKeys } from "~/lib/swr/portal-keys";
import type { ServerSeedEntry } from "~/lib/swr/server-seed";
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
      claims={[holidayKeys.hostedWeeks()]}
      load={async ({ token, session }) => {
        if (!hasPermission(session, "config:read")) return [];
        const hosted = seedRead("hostedHolidayWeeks", async (signal) => {
          const { data } = await readContract(
            routes["GET /api/holiday-weeks/"],
            { token, signal },
          );
          return data.map(mapWeek);
        });
        const entries: ServerSeedEntry[] = [
          {
            key: holidayKeys.hostedWeeks(),
            render: true,
            value: hosted,
          },
        ];
        const week = (await hosted)?.[0];
        if (week)
          entries.push({
            key: holidayKeys.ownChildren(week.id),
            value: seedRead("hostedWeekOwnChildAssignments", async (signal) => {
              const { data } = await readContract(
                routes["GET /api/holiday-weeks/{weekId}/own-children"],
                { token, signal, params: { weekId: week.id } },
              );
              return data.map(mapHolidayOwnChildAssignment);
            }),
          });
        return entries;
      }}
    >
      <PageContent />
    </TenantRouteSeed>
  );
}
