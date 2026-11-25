import { TenantRouteSeed } from "../../tenant-route-seed";
import { hasPermission } from "~/lib/auth-utils";
import { routes } from "~/lib/contract/guardians.generated";
import { canReviewGuardianApprovals } from "~/lib/guardian-approval-access";
import { mapPendingApproval } from "~/lib/guardian-api";
import { readContract, seedRead } from "~/lib/server-seed.server";
import { enrollmentKeys } from "~/lib/swr/enrollment-keys";
import PageContent from "./page-content";

export default async function GuardianApprovalsPage({
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
        if (
          !canReviewGuardianApprovals(session) ||
          !hasPermission(session, "users:manage")
        ) {
          return [];
        }
        return [
          {
            key: enrollmentKeys.pendingGuardianApprovals(),
            render: true,
            value: seedRead(
              "GET /api/guardians/invitations/pending-approval",
              async (signal) => {
                const { data } = await readContract(
                  routes["GET /api/guardians/invitations/pending-approval"],
                  { token, signal },
                );
                return data.map(mapPendingApproval);
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
