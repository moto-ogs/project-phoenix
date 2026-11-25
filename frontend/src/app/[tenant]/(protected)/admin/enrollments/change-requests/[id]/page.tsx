import { TenantRouteSeed } from "../../../../tenant-route-seed";
import { readContract, seedRead } from "~/lib/server-seed.server";
import { routes } from "~/lib/contract/enrollment.generated";
import { enrollmentKeys } from "~/lib/swr/enrollment-keys";
import { adminChangeRequestFromContract } from "~/lib/enrollment-admin-api";
import { canReviewEnrollmentChangeRequests } from "~/lib/change-request-access";
import PageContent from "./page-content";

export default async function AdminEnrollmentChangeRequestPage({
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
        if (!canReviewEnrollmentChangeRequests(session)) return [];
        return [
          {
            key: enrollmentKeys.changeRequest(id),
            render: true,
            value: seedRead(
              "GET /api/enrollment/admin/change-requests/{id}/",
              async (signal) => {
                const { data } = await readContract(
                  routes["GET /api/enrollment/admin/change-requests/{id}/"],
                  { token, signal, params: { id } },
                );
                return adminChangeRequestFromContract(data);
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
