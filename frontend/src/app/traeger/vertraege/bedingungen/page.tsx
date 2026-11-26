import { contractTemplates } from "~/lib/traeger/settings-seed-reads.server";
import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import { traegerPageSeed } from "~/lib/traeger/page-seed.server";
import TraegerVertragsbedingungenPage from "./page-content";

export default function Page() {
  const { seed, claims } = traegerPageSeed([contractTemplates]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <TraegerVertragsbedingungenPage />
      </SWRServerSeed>
    </Suspense>
  );
}
