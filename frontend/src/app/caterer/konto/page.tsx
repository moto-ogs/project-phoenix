import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import { catererAccountSeed } from "~/lib/caterer/page-seed.server";
import CatererAccountPage from "./page-content";

export default function Page() {
  const { seed, claims } = catererAccountSeed();
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <CatererAccountPage />
      </SWRServerSeed>
    </Suspense>
  );
}
