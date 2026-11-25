import { canReadSupervisionData, hasPermission } from "~/lib/auth-utils";
import { routes } from "~/lib/contract/active.generated";
import * as meContract from "~/lib/contract/me.generated";
import * as timetableContract from "~/lib/contract/timetable.generated";
import { readContract, seedOf, seedRead } from "~/lib/server-seed.server";
import { mapSupervisionDashboard } from "~/lib/supervision-dashboard-wire";
import { dashboardKeys, ownSupervisionKeys } from "~/lib/swr/shell-keys";
import { readTenantPageContext } from "~/lib/tenant-page-seed.server";
import { mapPlannedInstance } from "~/lib/timetable-operations-types";
import { mapActiveGroupResponse } from "~/lib/usercontext-helpers";

export async function loadActiveSupervisionsSeed(slug: string) {
  const builtAt = Date.now();
  const context = await readTenantPageContext(slug);
  if (!context || context.tenant.presenceMode === "binary") return null;
  const { snapshot, session, tenant, token } = context;
  if (
    !canReadSupervisionData(session) &&
    tenant.operationalOverviewScope !== "all_staff"
  ) {
    if (!hasPermission(session, "schedules:read")) return null;
    const planned = async (
      signal: AbortSignal,
      query: {
        scope?: "day";
        include_roster: boolean;
      },
    ) => {
      const answer = await readContract(
        timetableContract.routes["GET /api/timetable/operations/planned-now"],
        { token, signal, query },
      );
      return (answer.data.instances ?? []).map(mapPlannedInstance);
    };
    return seedOf(
      snapshot,
      [
        {
          key: ownSupervisionKeys.day(),
          render: true,
          value: seedRead("ownSupervisionDay", (signal) =>
            planned(signal, { scope: "day", include_roster: false }),
          ),
        },
        {
          key: ownSupervisionKeys.plannedNow(),
          render: true,
          value: seedRead("ownSupervisionUpcoming", (signal) =>
            planned(signal, { include_roster: true }),
          ),
        },
        {
          key: ownSupervisionKeys.sessions(),
          render: true,
          value: seedRead("ownSupervisionSessions", async (signal) => {
            const answer = await readContract(
              meContract.routes["GET /api/me/groups/supervised"],
              { token, signal },
            );
            return answer.data.map(mapActiveGroupResponse);
          }),
        },
      ],
      builtAt,
    );
  }

  return seedOf(
    snapshot,
    [
      {
        key: dashboardKeys.supervision(session.user.id),
        render: true,
        // The stable key's first browser read omits group_id. Route selections
        // are resolved against that aggregate, never put under the default key.
        value: seedRead("supervisionDashboard", async (signal) => {
          const answer = await readContract(
            routes["GET /api/active/supervision-dashboard"],
            { token, signal },
          );
          return mapSupervisionDashboard(answer.data);
        }),
      },
    ],
    builtAt,
  );
}
