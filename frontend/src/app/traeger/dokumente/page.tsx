import { documents } from "~/lib/traeger/administration-seed-reads.server";
import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import {
  traegerPageSeed,
  traegerSchools,
} from "~/lib/traeger/page-seed.server";
import TraegerDocumentsPage from "./page-content";

export default function Page() {
  const { seed, claims } = traegerPageSeed([documents, traegerSchools]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <TraegerDocumentsPage />
      </SWRServerSeed>
    </Suspense>
  );
}
