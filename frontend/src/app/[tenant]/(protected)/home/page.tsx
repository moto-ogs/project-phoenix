import { loadHomePlanningSeed, loadHomeSeed } from "~/lib/home-seed.server";
import HomeContent from "./page-content";
import { HomeSeed } from "./page-seed";

export const unstable_dynamicStaleTime = 60;

export default function HomePage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const seed = params
    .then(({ tenant }) => loadHomeSeed(tenant))
    .catch(() => null);
  const planningSeed = params
    .then(({ tenant }) => loadHomePlanningSeed(tenant))
    .catch(() => null);
  return (
    <HomeSeed seed={seed} planningSeed={planningSeed}>
      <HomeContent />
    </HomeSeed>
  );
}
