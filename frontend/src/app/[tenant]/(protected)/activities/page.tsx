import { TenantRouteSeed } from "../tenant-route-seed";
import { readContract, seedRead } from "~/lib/server-seed.server";
import * as contract from "~/lib/contract/activities.generated";
import * as me from "~/lib/contract/me.generated";
import { hasPermission } from "~/lib/auth-utils";
import {
  mapActivityResponse,
  mapActivityCategoryResponse,
} from "~/lib/activity-helpers";
import { mapStaffResponse } from "~/lib/usercontext-helpers";
import { tenantDailyKeys } from "~/lib/swr/tenant-daily-keys";
import PageContent from "./page-content";

export default async function ActivitiesPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;

  return (
    <TenantRouteSeed
      slug={tenant}
      module="nfc_anwesenheit"
      load={({ token, session, tenant: school }) => {
        if (
          school.presenceMode === "binary" ||
          (!hasPermission(session, "activities:list") &&
            !hasPermission(session, "activities:read"))
        )
          return [];
        return [
          {
            key: tenantDailyKeys.activitiesOverview(),
            render: true,
            value: seedRead("activities overview", async (signal) => {
              const [activities, categories, staff] = await Promise.all([
                readContract(contract.routes["GET /api/activities/"], {
                  token,
                  signal,
                }),
                readContract(
                  contract.routes["GET /api/activities/categories"],
                  { token, signal },
                ),
                readContract(me.routes["GET /api/me/staff"], {
                  token,
                  signal,
                }).catch(() => null),
              ]);
              return {
                activities: activities.data.map(mapActivityResponse),
                categories: categories.data.map(mapActivityCategoryResponse),
                currentStaff: staff?.data ? mapStaffResponse(staff.data) : null,
              };
            }),
          },
        ];
      }}
    >
      <PageContent />
    </TenantRouteSeed>
  );
}
