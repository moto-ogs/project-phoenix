import { connection } from "next/server";
import { berlinTodayISO } from "~/lib/date-helpers";
import { utilizationPresets } from "~/components/traeger/utilization-model";
import { utilization } from "~/lib/traeger/metrics-seed-reads.server";
import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import { traegerPageSeed } from "~/lib/traeger/page-seed.server";
import TraegerUtilizationPage from "./page-content";

export default async function Page() {
  await connection();
  const today = berlinTodayISO();
  const window = utilizationPresets(today)[1]?.window ?? {
    from: today,
    to: today,
  };
  const { seed, claims } = traegerPageSeed([utilization(window)]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <TraegerUtilizationPage />
      </SWRServerSeed>
    </Suspense>
  );
}
