import { TenantRouteSeed } from "../../tenant-route-seed";
import { readContract, seedRead } from "~/lib/server-seed.server";
import { routes } from "~/lib/contract/surveys.generated";
import { hasPermission } from "~/lib/auth-utils";
import { toSurvey } from "~/lib/surveys-api";
import { tenantAdminKeys } from "~/lib/swr/tenant-admin-keys";
import PageContent from "./page-content";

export default async function SurveyDetailPage({
  params,
}: {
  params: Promise<{ tenant: string; id: string }>;
}) {
  const { tenant, id } = await params;
  return (
    <TenantRouteSeed
      slug={tenant}
      load={({ token, session }) => {
        if (!hasPermission(session, "surveys:manage")) return [];
        return [
          {
            key: tenantAdminKeys.survey(id),
            render: true,
            value: seedRead("GET /api/surveys/{surveyId}", async (signal) => {
              const { data } = await readContract(
                routes["GET /api/surveys/{surveyId}"],
                { token, signal, params: { surveyId: id } },
              );
              return toSurvey(data);
            }),
          },
        ];
      }}
    >
      <PageContent />
    </TenantRouteSeed>
  );
}
