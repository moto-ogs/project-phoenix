import { TenantRouteSeed } from "../tenant-route-seed";
import { readContract, seedRead } from "~/lib/server-seed.server";
import { routes } from "~/lib/contract/surveys.generated";
import { hasPermission } from "~/lib/auth-utils";
import { toSurvey } from "~/lib/surveys-api";
import { tenantAdminKeys } from "~/lib/swr/tenant-admin-keys";
import PageContent from "./page-content";

export default async function SurveysPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  return (
    <TenantRouteSeed
      slug={tenant}
      load={({ token, session }) => {
        return [
          {
            key: tenantAdminKeys.surveysToAnswer(),
            render: true,
            value: seedRead("GET /api/surveys/to-answer", async (signal) => {
              const { data } = await readContract(
                routes["GET /api/surveys/to-answer"],
                { token, signal },
              );
              return data;
            }),
          },
          ...(hasPermission(session, "surveys:manage")
            ? [
                {
                  key: tenantAdminKeys.surveys(),
                  render: true,
                  value: seedRead("GET /api/surveys/", async (signal) => {
                    const { data } = await readContract(
                      routes["GET /api/surveys/"],
                      { token, signal },
                    );
                    return data.map(toSurvey);
                  }),
                },
              ]
            : []),
        ];
      }}
    >
      <PageContent />
    </TenantRouteSeed>
  );
}
