import { TenantRouteSeed } from "../tenant-route-seed";
import { readContract, seedRead } from "~/lib/server-seed.server";
import { routes } from "~/lib/contract/substitutions.generated";
import { hasPermission } from "~/lib/auth-utils";
import { berlinTodayISO } from "~/lib/date-helpers";
import {
  mapSubstitutionOverview,
  mapScheduleSubstitutionOverview,
} from "~/lib/substitution-helpers";
import { tenantListKeys } from "~/lib/swr/tenant-list-keys";
import PageContent from "./page-content";

export default async function SubstitutionsPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  return (
    <TenantRouteSeed
      slug={tenant}
      load={({ token, session }) => {
        if (!hasPermission(session, "substitutions:read")) return [];
        const today = berlinTodayISO();
        return [
          {
            key: tenantListKeys.substitutionOverview(),
            render: true,
            value: seedRead("GET /api/substitutions/", async (signal) => {
              const { data } = await readContract(
                routes["GET /api/substitutions/"],
                { token, signal },
              );
              return mapSubstitutionOverview(data);
            }),
          },
          ...(hasPermission(session, "schedules:read")
            ? [
                {
                  key: tenantListKeys.substitutionSchedule(today),
                  value: seedRead("GET /api/substitutions/", async (signal) => {
                    const { data } = await readContract(
                      routes["GET /api/substitutions/"],
                      { token, signal, query: { from: today, to: today } },
                    );
                    return mapScheduleSubstitutionOverview(data);
                  }),
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
