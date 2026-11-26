import { loadRequestInboxSeed } from "~/lib/request-inbox-seed.server";
import AnfragenContent from "./page-content";
import { AnfragenSeed } from "./page-seed";

export const unstable_dynamicStaleTime = 60;

export default async function AnfragenPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  const seed = loadRequestInboxSeed(tenant).catch(() => null);
  return (
    <AnfragenSeed seed={seed}>
      <AnfragenContent />
    </AnfragenSeed>
  );
}
