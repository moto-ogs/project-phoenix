import { TenantRouteSeed } from "../tenant-route-seed";
import { readContract, seedRead } from "~/lib/server-seed.server";
import { routes } from "~/lib/contract/staff-messages.generated";
import { messageKeys } from "~/lib/swr/portal-keys";
import PageContent from "./page-content";

export default async function TeamChatPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  return (
    <TenantRouteSeed
      slug={tenant}
      load={({ token, tenant: school }) => {
        if (!school.staffMessagingEnabled) return [];
        return [
          {
            key: messageKeys.teamChatInbox(false),
            render: true,
            value: seedRead("GET /api/staff-messages/", async (signal) => {
              const { data } = await readContract(
                routes["GET /api/staff-messages/"],
                { token, signal },
              );
              return data;
            }),
          },
        ];
      }}
    >
      <PageContent />
    </TenantRouteSeed>
  );
}
