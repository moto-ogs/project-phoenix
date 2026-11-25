import { TenantRouteSeed } from "../tenant-route-seed";
import { hasPermission } from "~/lib/auth-utils";
import { readContract, seedRead } from "~/lib/server-seed.server";
import { routes } from "~/lib/contract/settings.generated";
import { mapLoginImageSetting, toSettingsSchema } from "~/lib/settings-api";
import { shellResourceKeys } from "~/lib/swr/shell-keys";
import { tenantAdminKeys } from "~/lib/swr/tenant-admin-keys";
import {
  activeSettingsSectionId,
  settingsSelectionFor,
} from "~/components/settings/settings-sections";
import PageContent from "./page-content";

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{
    tab?: string | string[];
    highlight?: string | string[];
  }>;
}) {
  const [{ tenant: slug }, { tab, highlight }] = await Promise.all([
    params,
    searchParams,
  ]);
  const requestedTab = (Array.isArray(tab) ? tab[0] : tab) ?? null;
  const highlightKey =
    (Array.isArray(highlight) ? highlight[0] : highlight) ?? null;
  return (
    <TenantRouteSeed
      slug={slug}
      load={({ token, session, tenant }) => {
        const canRead = hasPermission(session, "config:read");
        const canUpdate = hasPermission(session, "config:update");
        const canManage = hasPermission(session, "config:manage");
        if (!canRead && !canUpdate && !canManage) return [];
        const schema = canRead
          ? seedRead("GET /api/settings/schema", async (signal) => {
              const { data } = await readContract(
                routes["GET /api/settings/schema"],
                { token, signal },
              );
              return toSettingsSchema(data);
            })
          : Promise.resolve(null);
        const selected = schema.then((data) => {
          if (data === undefined) return null;
          const sections = settingsSelectionFor(
            data,
            {
              schemaFailed: false,
              nfcEnabled: tenant.nfcEnabled,
              canManageHomeBlocks: canUpdate,
            },
            highlightKey,
          );
          return activeSettingsSectionId(sections, requestedTab);
        });
        return [
          ...(canRead
            ? [
                {
                  key: shellResourceKeys.settingsSchema(),
                  render: true,
                  value: schema,
                },
              ]
            : []),
          {
            key: tenantAdminKeys.loginImage(),
            value: selected.then((tabId) =>
              tabId === "settings-personalisierung"
                ? seedRead("GET /api/settings/login-image", async (signal) => {
                    const { data } = await readContract(
                      routes["GET /api/settings/login-image"],
                      { token, signal },
                    );
                    return mapLoginImageSetting(data);
                  })
                : undefined,
            ),
          },
        ];
      }}
    >
      <PageContent />
    </TenantRouteSeed>
  );
}
