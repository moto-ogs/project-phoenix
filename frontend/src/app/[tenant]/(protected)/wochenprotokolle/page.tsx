import { TenantRouteSeed } from "../tenant-route-seed";
import { readContract, seedRead } from "~/lib/server-seed.server";
import { routes } from "~/lib/contract/week-protocols.generated";
import { hasPermission } from "~/lib/auth-utils";
import { weekProtocolKeys } from "~/lib/swr/portal-keys";
import { mapWeekProtocol } from "~/lib/week-protocols-api";
import PageContent from "./page-content";

export default async function WeekProtocolsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ group?: string | string[] }>;
}) {
  const { tenant } = await params;
  const { group } = await searchParams;
  return (
    <TenantRouteSeed
      slug={tenant}
      load={({ token, session }) => {
        if (
          !hasPermission(session, "groups:update") &&
          !hasPermission(session, "groups:manage")
        )
          return [];
        const groupId = Array.isArray(group)
          ? (group[0] ?? null)
          : (group ?? null);
        return [
          {
            key: weekProtocolKeys.list(groupId),
            render: true,
            value: seedRead("GET /api/week-protocols/", async (signal) => {
              const { data } = await readContract(
                routes["GET /api/week-protocols/"],
                { token, signal, query: { group_id: groupId || undefined } },
              );
              return data.map(mapWeekProtocol);
            }),
          },
        ];
      }}
    >
      <PageContent />
    </TenantRouteSeed>
  );
}
