import { TenantRouteSeed } from "../tenant-route-seed";
import { readContract, seedRead } from "~/lib/server-seed.server";
import { routes } from "~/lib/contract/parent-announcements.generated";
import { hasPermission } from "~/lib/auth-utils";
import { toAnnouncement } from "~/lib/parent-announcements-api";
import { parentAnnouncementKeys } from "~/lib/swr/portal-keys";
import PageContent from "./page-content";

export default async function ParentAnnouncementsPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  return (
    <TenantRouteSeed
      slug={tenant}
      module="eltern_app"
      load={({ token, session }) => {
        if (!hasPermission(session, "admin:*")) return [];
        return [
          {
            key: parentAnnouncementKeys.list(),
            render: true,
            value: seedRead(
              "GET /api/parent-announcements/",
              async (signal) => {
                const { data } = await readContract(
                  routes["GET /api/parent-announcements/"],
                  { token, signal, query: { include_inactive: true } },
                );
                return data.map(toAnnouncement);
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
