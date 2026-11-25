import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import {
  accountsAtScope,
  operatorPageSeed,
  operatorQueryParam,
  organizationSummaries,
  schoolSummaries,
  type OperatorQuery,
} from "~/lib/operator/page-seed.server";
import OperatorSchoolDetailPage from "./page-content";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; schoolSlug: string }>;
  searchParams: Promise<OperatorQuery>;
}) {
  const [{ slug, schoolSlug }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  const accountsTab = operatorQueryParam(query, "tab") === "konten";
  const { seed, claims } = operatorPageSeed(
    accountsTab
      ? [organizationSummaries, schoolSummaries]
      : [organizationSummaries],
    accountsTab
      ? async (token) => {
          const [organizations, schools] = await Promise.all([
            organizationSummaries.load(token),
            schoolSummaries.load(token),
          ]);
          const organization = organizations?.find((row) => row.slug === slug);
          const school = schools?.find(
            (row) =>
              row.slug === schoolSlug &&
              row.organizationId === organization?.id,
          );
          return school && !school.deletedAt
            ? [accountsAtScope({ kind: "school", id: school.id })]
            : [];
        }
      : undefined,
  );
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <OperatorSchoolDetailPage params={params} />
      </SWRServerSeed>
    </Suspense>
  );
}
