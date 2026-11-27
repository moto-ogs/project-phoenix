import { TenantRouteSeed } from "../../../tenant-route-seed";
import { readContract, seedRead } from "~/lib/server-seed.server";
import { routes } from "~/lib/contract/enrollment.generated";
import { hasPermission } from "~/lib/auth-utils";
import { enrollmentKeys } from "~/lib/swr/enrollment-keys";
import PageContent from "./page-content";

export default async function RolloverReviewPage({
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
            key: enrollmentKeys.rolloverReview(id),
            render: true,
            value: seedRead(
              "GET /api/enrollment/phases/{id}/review",
              async (signal) => {
                const { data } = await readContract(
                  routes["GET /api/enrollment/phases/{id}/review"],
                  { token, signal, params: { id } },
                );
                return data;
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
