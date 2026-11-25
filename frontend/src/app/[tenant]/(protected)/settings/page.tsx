import { TenantRouteSeed } from "../tenant-route-seed";
import { readContract, seedRead } from "~/lib/server-seed.server";
import { routes } from "~/lib/contract/settings.generated";
import { toSettingsSchema } from "~/lib/settings-api";
import { shellResourceKeys } from "~/lib/swr/shell-keys";
import PageContent from "./page-content";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  return (
    <TenantRouteSeed
      slug={tenant}
      load={({ token }) => {
        return [
          {
            key: shellResourceKeys.settingsSchema(),
            render: true,
            value: seedRead("GET /api/settings/schema", async (signal) => {
              const { data } = await readContract(
                routes["GET /api/settings/schema"],
                { token, signal },
              );
              return toSettingsSchema(data);
            }),
          },
        ];
      }}
    >
      <PageContent />
    </TenantRouteSeed>
  );
}
