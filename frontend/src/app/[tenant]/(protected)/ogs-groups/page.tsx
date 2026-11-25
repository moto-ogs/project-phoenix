import { TenantRouteSeed } from "../tenant-route-seed";
import { readContract, seedRead } from "~/lib/server-seed.server";
import * as contract from "~/lib/contract/students.generated";
import { canReadStudents } from "~/lib/student-access";
import {
  hasEffectiveAdminScope,
  hasPermission,
  isCaregiver,
} from "~/lib/auth-utils";
import { isPositiveInt64Id } from "~/lib/compare-ids";
import { mapOgsGroupLiveResponse } from "~/lib/ogs-group-live-api";
import { groupKeys } from "~/lib/swr/groups-keys";
import PageContent from "./page-content";

export default async function OGSGroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenant } = await params;
  const query = await searchParams;
  const group = Array.isArray(query.group) ? query.group[0] : query.group;
  return (
    <TenantRouteSeed
      slug={tenant}
      load={({ token, session, tenant: school }) => {
        if (
          !group ||
          !isPositiveInt64Id(group) ||
          school.groupMode === "open_care"
        )
          return [];
        if (
          !canReadStudents(session) ||
          !(
            hasEffectiveAdminScope(session) ||
            isCaregiver(session) ||
            hasPermission(session, "groups:read")
          )
        )
          return [];
        // A missing group is not a default on this route: a browser may have
        // an account-scoped browser selection that the server cannot see.
        return [
          {
            key: groupKeys.live(group),
            value: seedRead(
              "GET /api/students/ogs-group-live",
              async (signal) => {
                const { data } = await readContract(
                  contract.routes["GET /api/students/ogs-group-live"],
                  { token, signal, query: { group_id: group } },
                );
                return mapOgsGroupLiveResponse(data);
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
