import { TenantRouteSeed } from "../../tenant-route-seed";
import { readContract, seedRead } from "~/lib/server-seed.server";
import { routes } from "~/lib/contract/surveys.generated";
import { hasPermission } from "~/lib/auth-utils";
import {
  mapSurveyRespondents,
  mapSurveyResults,
  toSurvey,
} from "~/lib/surveys-api";
import { tenantAdminKeys } from "~/lib/swr/tenant-admin-keys";
import PageContent from "./page-content";

export default async function SurveyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; id: string }>;
  searchParams: Promise<{ reiter?: string | string[] }>;
}) {
  const [{ tenant, id }, { reiter }] = await Promise.all([
    params,
    searchParams,
  ]);
  const peopleTab = (Array.isArray(reiter) ? reiter[0] : reiter) === "personen";
  const routeParams = { surveyId: id };
  return (
    <TenantRouteSeed
      slug={tenant}
      load={({ token, session }) => {
        if (!hasPermission(session, "surveys:manage")) return [];
        const survey = seedRead(
          "GET /api/surveys/{surveyId}",
          async (signal) => {
            const { data } = await readContract(
              routes["GET /api/surveys/{surveyId}"],
              {
                token,
                signal,
                params: routeParams,
              },
            );
            return toSurvey(data);
          },
        );
        return [
          { key: tenantAdminKeys.survey(id), render: true, value: survey },
          {
            key: tenantAdminKeys.surveyResults(id),
            value: survey.then((data) =>
              data && data.status !== "draft"
                ? seedRead(
                    "GET /api/surveys/{surveyId}/results",
                    async (signal) => {
                      const { data } = await readContract(
                        routes["GET /api/surveys/{surveyId}/results"],
                        {
                          token,
                          signal,
                          params: routeParams,
                        },
                      );
                      return mapSurveyResults(data);
                    },
                  )
                : undefined,
            ),
          },
          ...(peopleTab
            ? [
                {
                  key: tenantAdminKeys.surveyRespondents(id),
                  value: survey.then((data) =>
                    data && data.status !== "draft" && !data.anonymous
                      ? seedRead(
                          "GET /api/surveys/{surveyId}/respondents",
                          async (signal) => {
                            const { data } = await readContract(
                              routes["GET /api/surveys/{surveyId}/respondents"],
                              {
                                token,
                                signal,
                                params: routeParams,
                              },
                            );
                            return mapSurveyRespondents(data);
                          },
                        )
                      : undefined,
                  ),
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
