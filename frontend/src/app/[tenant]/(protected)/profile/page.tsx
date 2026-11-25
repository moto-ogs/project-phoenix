import { TenantRouteSeed } from "../tenant-route-seed";
import { hasPermission } from "~/lib/auth-utils";
import * as mfa from "~/lib/contract/auth-mfa.generated";
import * as passkeys from "~/lib/contract/auth-passkeys.generated";
import * as birthdays from "~/lib/contract/birthdays.generated";
import * as messages from "~/lib/contract/messages.generated";
import * as notifications from "~/lib/contract/notifications.generated";
import { mapNotificationPreferences } from "~/lib/notification-preferences-api";
import { mapMessageCountSetting } from "~/lib/parent-messages-api";
import { readContract, seedRead } from "~/lib/server-seed.server";
import type { ServerSeedEntry } from "~/lib/swr/server-seed";
import { tenantAdminKeys } from "~/lib/swr/tenant-admin-keys";
import PageContent from "./page-content";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant: slug } = await params;
  return (
    <TenantRouteSeed
      slug={slug}
      load={({ token, session, tenant }) => {
        const entries: ServerSeedEntry[] = [
          {
            key: tenantAdminKeys.notificationPreferences("tenant"),
            value: seedRead(
              "GET /api/notifications/preferences/",
              async (signal) => {
                const { data } = await readContract(
                  notifications.routes["GET /api/notifications/preferences/"],
                  { token, signal },
                );
                return mapNotificationPreferences(data);
              },
            ),
          },
          {
            key: tenantAdminKeys.birthdayOptOut(),
            value: seedRead("GET /api/birthdays/opt-out", async (signal) => {
              const { data } = await readContract(
                birthdays.routes["GET /api/birthdays/opt-out"],
                { token, signal },
              );
              return data.opt_out;
            }),
          },
          {
            key: tenantAdminKeys.trustedDevices("tenant"),
            value: seedRead(
              "GET /auth/mfa/trusted-devices",
              async (signal) =>
                (
                  await readContract(
                    mfa.routes["GET /auth/mfa/trusted-devices"],
                    { token, signal },
                  )
                ).data,
            ),
          },
        ];
        // The account passkey handler rejects Träger claims, including a
        // session able to display a school through the Team portal.
        if (session.user.scope !== "org") {
          entries.push({
            key: tenantAdminKeys.passkeys("tenant"),
            value: seedRead(
              "GET /auth/passkeys/",
              async (signal) =>
                (
                  await readContract(passkeys.routes["GET /auth/passkeys/"], {
                    token,
                    signal,
                  })
                ).data,
            ),
          });
        }
        if (tenant.messagingEnabled && hasPermission(session, "users:read")) {
          entries.push({
            key: tenantAdminKeys.messageCountSetting(),
            value: seedRead("GET /api/messages/count-scope", async (signal) => {
              const { data } = await readContract(
                messages.routes["GET /api/messages/count-scope"],
                { token, signal },
              );
              return mapMessageCountSetting(data);
            }),
          });
        }
        return entries;
      }}
    >
      <PageContent />
    </TenantRouteSeed>
  );
}
