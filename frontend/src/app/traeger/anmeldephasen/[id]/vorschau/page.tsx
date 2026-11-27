import { catalogPhase } from "~/lib/traeger/holiday-seed-reads.server";
import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import {
  traegerPageSeed,
  traegerSchools,
} from "~/lib/traeger/page-seed.server";
import TraegerCatalogPreviewPage from "./page-content";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { seed, claims } = traegerPageSeed([catalogPhase(id), traegerSchools]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <TraegerCatalogPreviewPage />
      </SWRServerSeed>
    </Suspense>
  );
}
