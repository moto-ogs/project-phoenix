import { Suspense } from "react";
import { CatererServerSeed } from "~/components/caterer/caterer-server-seed";
import { loadCatererPageSeed } from "~/lib/caterer/page-seed.server";
import CatererOverviewPage from "./page-content";

export default function Page() {
  const seed = loadCatererPageSeed().catch(() => null);
  return (
    <Suspense fallback={null}>
      <CatererServerSeed seed={seed}>
        <CatererOverviewPage />
      </CatererServerSeed>
    </Suspense>
  );
}
