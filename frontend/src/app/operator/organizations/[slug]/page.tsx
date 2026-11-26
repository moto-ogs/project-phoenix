import { Suspense } from "react";
import {
  operatorPageSeed,
  accountsAtScope,
  operatorQueryParam,
  organizationDevices,
  organizationErasureOrder,
  organizationSummaries,
  type OperatorQuery,
} from "~/lib/operator/page-seed.server";
import { OrganizationSeed } from "./organization-seed";
import OperatorOrganizationDetailPage from "./page-content";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<OperatorQuery>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const tab = operatorQueryParam(query, "tab");
  const preloadTab =
    tab === "geraete" || tab === "loeschauftrag" || tab === "konten"
      ? tab
      : null;
  const { seed } = operatorPageSeed(
    [organizationSummaries],
    preloadTab
      ? async (token) => {
          const listed = await organizationSummaries.load(token);
          const id = listed?.find((entry) => entry.slug === slug)?.id;
          return id
            ? [
                preloadTab === "geraete"
                  ? organizationDevices(id)
                  : preloadTab === "konten"
                    ? accountsAtScope({ kind: "organization", id })
                    : organizationErasureOrder(id),
              ]
            : [];
        }
      : undefined,
  );
  return (
    <Suspense fallback={null}>
      <OrganizationSeed seed={seed} slug={slug} tab={preloadTab}>
        <OperatorOrganizationDetailPage params={params} />
      </OrganizationSeed>
    </Suspense>
  );
}
