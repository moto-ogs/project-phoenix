import { catalogPhases } from "~/lib/traeger/holiday-seed-reads.server";
import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import {
  traegerPageSeed,
  traegerSchools,
} from "~/lib/traeger/page-seed.server";
import TraegerCatalogPhasesPage from "./page-content";

export default function Page() {
  const { seed, claims } = traegerPageSeed([catalogPhases, traegerSchools]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <TraegerCatalogPhasesPage />
      </SWRServerSeed>
    </Suspense>
  );
}
