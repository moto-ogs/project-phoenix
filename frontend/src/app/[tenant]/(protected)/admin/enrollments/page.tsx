import { TenantRouteSeed } from "../../tenant-route-seed";
import { readContract, seedRead } from "~/lib/server-seed.server";
import { routes } from "~/lib/contract/enrollment.generated";
import { hasPermission } from "~/lib/auth-utils";
import { enrollmentKeys } from "~/lib/swr/enrollment-keys";
import { careOfferingCountsByPhase } from "~/lib/care-offering-api";
import {
  mapPhaseExpiryWarning,
  phaseFromContract,
} from "~/lib/enrollment-phase-api";
import { formSchemaFromContract } from "~/lib/enrollment-form-schema-api";
import { toSettingsSchema } from "~/lib/settings-api";
import { shellResourceKeys } from "~/lib/swr/shell-keys";
import {
  requestSummaryFromContract,
  adminChangeRequestFromContract,
} from "~/lib/enrollment-admin-api";
import * as settingContract from "~/lib/contract/settings.generated";
import * as notificationContract from "~/lib/contract/notifications.generated";
import { tenantAdminKeys } from "~/lib/swr/tenant-admin-keys";
import PageContent from "./page-content";

export default async function AdminEnrollmentsPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  return (
    <TenantRouteSeed
      slug={tenant}
      module="online_anmeldung"
      load={({ token, session }) => {
        if (!hasPermission(session, "config:manage")) return [];
        const type = "enrollment_submitted";
        const phases = seedRead(
          "GET /api/enrollment/phases/",
          async (signal) => {
            const { data } = await readContract(
              routes["GET /api/enrollment/phases/"],
              { token, signal },
            );
            return data.map(phaseFromContract);
          },
        );
        return [
          { key: enrollmentKeys.phases(), render: true, value: phases },
          {
            key: enrollmentKeys.careOfferingCounts(),
            render: true,
            value: phases.then((items) =>
              items?.length
                ? seedRead(
                    "GET /api/enrollment/care-offerings/",
                    async (signal) => {
                      const { data } = await readContract(
                        routes["GET /api/enrollment/care-offerings/"],
                        { token, signal },
                      );
                      return careOfferingCountsByPhase(data);
                    },
                  )
                : undefined,
            ),
          },
          {
            key: enrollmentKeys.phaseExpiryWarnings(),
            value: seedRead(
              "GET /api/enrollment/phases/expiry-warnings",
              async (signal) => {
                const { data } = await readContract(
                  routes["GET /api/enrollment/phases/expiry-warnings"],
                  { token, signal },
                );
                return data.map(mapPhaseExpiryWarning);
              },
            ),
          },
          {
            key: enrollmentKeys.formSchemas(),
            render: true,
            value: seedRead(
              "GET /api/enrollment/schema/versions",
              async (signal) => {
                const { data } = await readContract(
                  routes["GET /api/enrollment/schema/versions"],
                  { token, signal },
                );
                return data.map(formSchemaFromContract);
              },
            ),
          },
          {
            key: shellResourceKeys.settingsSchema(),
            render: true,
            value: seedRead("GET /api/settings/schema", async (signal) => {
              const { data } = await readContract(
                settingContract.routes["GET /api/settings/schema"],
                { token, signal },
              );
              return toSettingsSchema(data);
            }),
          },
          {
            key: enrollmentKeys.adminRequests(),
            render: true,
            value: seedRead(
              "GET /api/enrollment/admin/requests/",
              async (signal) => {
                const { data } = await readContract(
                  routes["GET /api/enrollment/admin/requests/"],
                  { token, signal },
                );
                return data.map(requestSummaryFromContract);
              },
            ),
          },
          {
            key: enrollmentKeys.changeRequests(),
            value: seedRead(
              "GET /api/enrollment/admin/change-requests/",
              async (signal) => {
                const { data } = await readContract(
                  routes["GET /api/enrollment/admin/change-requests/"],
                  { token, signal },
                );
                return data.map(adminChangeRequestFromContract);
              },
            ),
          },
          {
            key: tenantAdminKeys.emailSubscription(type),
            value: seedRead(
              "GET /api/notifications/email-subscriptions/{type}",
              async (signal) => {
                const { data } = await readContract(
                  notificationContract.routes[
                    "GET /api/notifications/email-subscriptions/{type}"
                  ],
                  { token, signal, params: { type } },
                );
                return data.enabled;
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
