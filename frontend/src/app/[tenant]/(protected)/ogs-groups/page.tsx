import { TenantRouteSeed } from "../tenant-route-seed";
import { readContract, seedRead } from "~/lib/server-seed.server";
import * as contract from "~/lib/contract/students.generated";
import { canReadStudents } from "~/lib/student-access";
import {
  hasEffectiveAdminScope,
  hasPermission,
  isCaregiver,
} from "~/lib/auth-utils";
import { holidayGuestBadgeSeed } from "~/lib/holiday-guest-badge-seed.server";
import { holidayGuestIds } from "~/lib/holiday-host-api";
import type { ServerSeedEntry } from "~/lib/swr/server-seed";
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
      claims={group ? [groupKeys.live(group)] : []}
      load={async ({ token, session, tenant: school }) => {
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
        // Never infer a group from a URL without an ID: the browser may have
        // an account-local selection the server cannot see.
        const live = seedRead(
          "GET /api/students/ogs-group-live",
          async (signal) => {
            const { data } = await readContract(
              contract.routes["GET /api/students/ogs-group-live"],
              { token, signal, query: { group_id: group } },
            );
            return mapOgsGroupLiveResponse(data);
          },
        );
        const entries: ServerSeedEntry[] = [
          { key: groupKeys.live(group), value: live },
        ];
        if (hasPermission(session, "students:read")) {
          const roster = await live;
          if (roster?.groupId === group) {
            const guestIds = holidayGuestIds(roster.students);
            if (guestIds.length)
              entries.push(holidayGuestBadgeSeed(token, guestIds));
          }
        }
        return entries;
      }}
    >
      <PageContent />
    </TenantRouteSeed>
  );
}
