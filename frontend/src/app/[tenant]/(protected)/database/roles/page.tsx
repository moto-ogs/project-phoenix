import { readDatabaseCatalogSeed } from "~/lib/database-catalog-seed.server";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import CatalogContent from "./page-content";

export default async function CatalogPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ tenant }, query] = await Promise.all([params, searchParams]);
  const value = query.role;
  const selected = Array.isArray(value) ? value[0] : value;
  const { seed, claims } = readDatabaseCatalogSeed(tenant, "roles", selected);
  return (
    <SWRServerSeed seed={seed} claims={claims} render>
      <CatalogContent />
    </SWRServerSeed>
  );
}
