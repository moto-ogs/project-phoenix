import { connection } from "next/server";
import { berlinTodayISO } from "~/lib/date-helpers";
import { utilizationPresets } from "~/components/traeger/utilization-model";
import { comparison } from "~/lib/traeger/metrics-seed-reads.server";
import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import {
  traegerPageSeed,
  traegerSchools,
} from "~/lib/traeger/page-seed.server";
import TraegerComparisonPage from "./page-content";

export default async function Page() {
  await connection();
  const today = berlinTodayISO();
  const window = utilizationPresets(today)[0]?.window ?? {
    from: today,
    to: today,
  };
  const { seed, claims } = traegerPageSeed([
    comparison({ ...window, schoolIds: [] }),
    traegerSchools,
  ]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <TraegerComparisonPage />
      </SWRServerSeed>
    </Suspense>
  );
}
