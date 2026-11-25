import { loadHomeSeed } from "~/lib/home-seed.server";
import HomeContent from "./page-content";
import { HomeSeed } from "./page-seed";

export default async function HomePage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  const seed = loadHomeSeed(tenant).catch(() => null);
  return (
    <HomeSeed seed={seed}>
      <HomeContent />
    </HomeSeed>
  );
}
