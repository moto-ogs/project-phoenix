import { holidayCriteria } from "~/lib/traeger/holiday-seed-reads.server";
import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import { traegerPageSeed } from "~/lib/traeger/page-seed.server";
import TraegerHolidayCriteriaPage from "./page-content";

export default function Page() {
  const { seed, claims } = traegerPageSeed([holidayCriteria]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <TraegerHolidayCriteriaPage />
      </SWRServerSeed>
    </Suspense>
  );
}
