import { TenantRouteSeed } from "../../../tenant-route-seed";
import { readContract, seedRead } from "~/lib/server-seed.server";
import { routes } from "~/lib/contract/enrollment.generated";
import { hasPermission } from "~/lib/auth-utils";
import { phaseFromContract } from "~/lib/enrollment-phase-api";
import { tenantAdminKeys } from "~/lib/swr/tenant-admin-keys";
import PageContent from "./page-content";

export default async function MobileRolloverPage({
  params,
}: {
  params: Promise<{ tenant: string; id: string }>;
}) {
  const { tenant, id } = await params;
  return (
    <TenantRouteSeed
      slug={tenant}
      module="online_anmeldung"
      load={({ token, session }) => {
        if (!hasPermission(session, "config:manage")) return [];
        return [
          {
            key: tenantAdminKeys.enrollmentPhase(id),
            render: true,
            value: seedRead(
              "GET /api/enrollment/phases/{id}/",
              async (signal) => {
                const { data } = await readContract(
                  routes["GET /api/enrollment/phases/{id}/"],
                  { token, signal, params: { id } },
                );
                return phaseFromContract(data);
              },
            ),
          },
        ];
      }}
    >
      <PageContent params={params} />
    </TenantRouteSeed>
  );
}
