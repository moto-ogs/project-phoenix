import { occupancy } from "~/lib/traeger/overview-seed-reads.server";
import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import { traegerPageSeed } from "~/lib/traeger/page-seed.server";
import TraegerOccupancyPage from "./page-content";

export default function Page() {
  const { seed, claims } = traegerPageSeed([occupancy]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <TraegerOccupancyPage />
      </SWRServerSeed>
    </Suspense>
  );
}
