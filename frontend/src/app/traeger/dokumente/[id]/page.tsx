import {
  documents,
  documentAudiences,
} from "~/lib/traeger/administration-seed-reads.server";
import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import {
  traegerPageSeed,
  traegerSchools,
} from "~/lib/traeger/page-seed.server";
import TraegerDocumentPage from "./page-content";

export default function Page() {
  const { seed, claims } = traegerPageSeed([
    documents,
    { ...documentAudiences, permission: "traeger_documents:manage" },
    traegerSchools,
  ]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <TraegerDocumentPage />
      </SWRServerSeed>
    </Suspense>
  );
}
