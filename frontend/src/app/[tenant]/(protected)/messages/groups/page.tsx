import { TenantRouteSeed } from "../../tenant-route-seed";
import { readContract, seedRead } from "~/lib/server-seed.server";
import { routes } from "~/lib/contract/messages.generated";
import { hasPermission } from "~/lib/auth-utils";
import { messageKeys } from "~/lib/swr/portal-keys";
import PageContent from "./page-content";

export default async function MessagesPage({
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
        if (!hasPermission(session, "users:read")) return [];
        return [
          {
            key: messageKeys.groupMessages(),
            render: true,
            value: seedRead(
              "GET /api/messages/group-threads",
              async (signal) => {
                const { data } = await readContract(
                  routes["GET /api/messages/group-threads"],
                  { token, signal },
                );
                return data;
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
