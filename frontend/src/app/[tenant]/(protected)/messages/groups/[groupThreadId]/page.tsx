import { TenantRouteSeed } from "../../../tenant-route-seed";
import { readContract, seedRead } from "~/lib/server-seed.server";
import { routes } from "~/lib/contract/messages.generated";
import { hasPermission } from "~/lib/auth-utils";
import { messageKeys } from "~/lib/swr/portal-keys";
import { withLists } from "~/lib/parent-group-threads-api";
import PageContent from "./page-content";

export default async function MessagesPage({
  params,
}: {
  params: Promise<{ tenant: string; groupThreadId: string }>;
}) {
  const { tenant, groupThreadId } = await params;
  return (
    <TenantRouteSeed
      slug={tenant}
      module="eltern_app"
      load={({ token, session }) => {
        if (!hasPermission(session, "users:read")) return [];
        return [
          {
            key: messageKeys.groupMessage(groupThreadId),
            render: true,
            value: seedRead(
              "GET /api/messages/group-threads/{groupThreadId}",
              async (signal) => {
                const { data } = await readContract(
                  routes["GET /api/messages/group-threads/{groupThreadId}"],
                  { token, signal, params: { groupThreadId } },
                );
                return withLists(data);
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
