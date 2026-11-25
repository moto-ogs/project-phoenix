import { occupancy } from "~/lib/traeger/overview-seed-reads.server";
import { Suspense } from "react";
import { connection } from "next/server";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import { traegerPageSeed } from "~/lib/traeger/page-seed.server";
import TraegerOccupancyPage from "./page-content";

export default async function Page() {
  await connection();
  const { seed, claims } = traegerPageSeed([occupancy]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <TraegerOccupancyPage />
      </SWRServerSeed>
    </Suspense>
  );
}
