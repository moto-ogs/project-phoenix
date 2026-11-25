import { hasPermission } from "~/lib/auth-utils";
import { isPositiveInt64Id } from "~/lib/compare-ids";
import { routes } from "~/lib/contract/students.generated";
import { readContract, seedOf, seedRead } from "~/lib/server-seed.server";
import { studentKeys } from "~/lib/swr/portal-keys";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import { readTenantPageContext } from "~/lib/tenant-page-seed.server";
import ChangeHistoryContent from "./page-content";

export default async function ChangeHistoryPage({
  params,
}: {
  params: Promise<{ tenant: string; id: string }>;
}) {
  const { tenant, id } = await params;
  const key = studentKeys.changeHistory(id);
  const builtAt = Date.now();
  const seed = readTenantPageContext(tenant)
    .then((context) => {
      if (
        !context ||
        !isPositiveInt64Id(id) ||
        !hasPermission(context.session, "users:read")
      )
        return null;
      const { snapshot, token } = context;
      // Go independently checks full access to this child and filters document categories.
      return seedOf(
        snapshot,
        [
          {
            key,
            value: seedRead(
              "studentChangeHistory",
              async (signal) =>
                (
                  await readContract(
                    routes["GET /api/students/{id}/change-history"],
                    { params: { id }, token, signal },
                  )
                ).data,
            ),
          },
        ],
        builtAt,
      );
    })
    .catch(() => null);
  return (
    <SWRServerSeed seed={seed} claims={[key]}>
      <ChangeHistoryContent />
    </SWRServerSeed>
  );
}
