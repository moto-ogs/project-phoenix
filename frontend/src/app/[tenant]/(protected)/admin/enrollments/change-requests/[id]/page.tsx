import { hasPermission } from "~/lib/auth-utils";
import { readContract, seedOf, seedRead } from "~/lib/server-seed.server";
import { routes } from "~/lib/contract/enrollment.generated";
import { enrollmentKeys } from "~/lib/swr/enrollment-keys";
import { adminChangeRequestFromContract } from "~/lib/enrollment-admin-api";
import { formLabelsFromContract } from "~/lib/enrollment-change-request-diff";
import { readTenantPageContext } from "~/lib/tenant-page-seed.server";
import type { ServerSeedEntry } from "~/lib/swr/server-seed";
import PageContent from "./page-content";
import { ChangeRequestSeed } from "./page-seed";

async function loadSeed(slug: string, id: string) {
  const context = await readTenantPageContext(slug, "online_anmeldung").catch(
    () => null,
  );
  if (!context || !hasPermission(context.session, "config:manage")) return null;
  const builtAt = Date.now();
  const { token, snapshot } = context;
  const request = seedRead(
    "GET /api/enrollment/admin/change-requests/{id}/",
    async (signal) => {
      const { data } = await readContract(
        routes["GET /api/enrollment/admin/change-requests/{id}/"],
        {
          token,
          signal,
          params: { id },
        },
      );
      return adminChangeRequestFromContract(data);
    },
  );
  const entries: ServerSeedEntry[] = [
    { key: enrollmentKeys.changeRequest(id), render: true, value: request },
  ];
  const data = await request;
  if (data?.id === id && data.request_id) {
    const requestId = data.request_id;
    entries.push({
      key: enrollmentKeys.formLabels(requestId),
      value: seedRead(
        "GET /api/enrollment/admin/requests/{id}/form-labels",
        async (signal) => {
          const { data } = await readContract(
            routes["GET /api/enrollment/admin/requests/{id}/form-labels"],
            {
              token,
              signal,
              params: { id: requestId },
            },
          );
          return formLabelsFromContract(data);
        },
      ),
    });
  }
  return seedOf(snapshot, entries, builtAt);
}

export default async function AdminEnrollmentChangeRequestPage({
  params,
}: {
  params: Promise<{ tenant: string; id: string }>;
}) {
  const { tenant, id } = await params;
  return (
    <ChangeRequestSeed id={id} seed={loadSeed(tenant, id)}>
      <PageContent params={params} />
    </ChangeRequestSeed>
  );
}
