import { conclusionModes } from "~/lib/traeger/settings-seed-reads.server";
import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import {
  traegerPageSeed,
  traegerSchools,
} from "~/lib/traeger/page-seed.server";
import TraegerVertraegePage from "./page-content";

export default function Page() {
  const { seed, claims } = traegerPageSeed([conclusionModes, traegerSchools]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <TraegerVertraegePage />
      </SWRServerSeed>
    </Suspense>
  );
}
