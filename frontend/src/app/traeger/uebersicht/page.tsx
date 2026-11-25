import {
  schoolsAlerts,
  requiredDetails,
} from "~/lib/traeger/overview-seed-reads.server";
import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import { traegerPageSeed } from "~/lib/traeger/page-seed.server";
import TraegerDashboardPage from "./page-content";

export default function Page() {
  const { seed, claims } = traegerPageSeed([schoolsAlerts, requiredDetails]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <TraegerDashboardPage />
      </SWRServerSeed>
    </Suspense>
  );
}
