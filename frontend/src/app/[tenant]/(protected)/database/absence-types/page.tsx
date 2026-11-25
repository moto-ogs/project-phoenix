import { readDatabaseCatalogSeed } from "~/lib/database-catalog-seed.server";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import CatalogContent from "./page-content";

export default async function CatalogPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  const { seed, claims } = readDatabaseCatalogSeed(tenant, "absence-types");
  return (
    <SWRServerSeed seed={seed} claims={claims} render>
      <CatalogContent />
    </SWRServerSeed>
  );
}
