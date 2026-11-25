import { hasPermission } from "~/lib/auth-utils";
import { isPositiveInt64Id } from "~/lib/compare-ids";
import { contractGet } from "~/lib/contract/client.server";
import { routes } from "~/lib/contract/feedback.generated";
import { mapFeedbackResponse } from "~/lib/feedback-api";
import { seedOf, seedRead } from "~/lib/server-seed.server";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import { tenantStudentKeys } from "~/lib/swr/tenant-student-keys";
import { readTenantPageContext } from "~/lib/tenant-page-seed.server";
import FeedbackHistoryContent from "./page-content";

export default async function FeedbackHistoryPage({
  params,
}: {
  params: Promise<{ tenant: string; id: string }>;
}) {
  const { tenant, id } = await params;
  const key = tenantStudentKeys.feedback(id);
  const builtAt = Date.now();
  const seed = readTenantPageContext(tenant)
    .then((context) => {
      if (
        !context ||
        !isPositiveInt64Id(id) ||
        !hasPermission(context.session, "feedback:read")
      )
        return null;
      const { snapshot, token } = context;
      return seedOf(
        snapshot,
        [
          {
            key,
            value: seedRead("studentFeedbackHistory", async (signal) => {
              const result = await contractGet(
                routes["GET /api/feedback/student/{id}"],
                { params: { id }, token, signal },
              );
              if (result.ok) return result.value.data.map(mapFeedbackResponse);
              if (result.error.status === 404) return [];
              throw result.error.cause;
            }),
          },
        ],
        builtAt,
      );
    })
    .catch(() => null);
  return (
    <SWRServerSeed seed={seed} claims={[key]}>
      <FeedbackHistoryContent />
    </SWRServerSeed>
  );
}
