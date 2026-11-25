import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import {
  traegerPageSeed,
  profile,
  trustedDevices,
} from "~/lib/traeger/page-seed.server";
import TraegerAccountPage from "./page-content";

export default function Page() {
  const { seed, claims } = traegerPageSeed([profile, trustedDevices]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <TraegerAccountPage />
      </SWRServerSeed>
    </Suspense>
  );
}
