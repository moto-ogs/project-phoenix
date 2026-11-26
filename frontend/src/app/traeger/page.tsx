import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import {
  traegerPageSeed,
  traegerSchools,
} from "~/lib/traeger/page-seed.server";
import TraegerSchoolsPage from "./page-content";

export default function Page() {
  const { seed, claims } = traegerPageSeed([traegerSchools]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <TraegerSchoolsPage />
      </SWRServerSeed>
    </Suspense>
  );
}
