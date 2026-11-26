import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import {
  traegerPageSeed,
  traegerSchools,
} from "~/lib/traeger/page-seed.server";
import TraegerChildrenPage from "./page-content";

// The schools name the reiters and are seeded. The children are person data
// the schools' access logs record, so the browser reads them on opening.
export default function Page() {
  const { seed, claims } = traegerPageSeed([traegerSchools]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <TraegerChildrenPage />
      </SWRServerSeed>
    </Suspense>
  );
}
