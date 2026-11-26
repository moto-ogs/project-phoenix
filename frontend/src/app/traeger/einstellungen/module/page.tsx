import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import { traegerPageSeed, organization } from "~/lib/traeger/page-seed.server";
import TraegerModulesPage from "./page-content";

export default function Page() {
  const { seed, claims } = traegerPageSeed([organization]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <TraegerModulesPage />
      </SWRServerSeed>
    </Suspense>
  );
}
