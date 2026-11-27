import { careMealTariffs } from "~/lib/traeger/billing-seed-reads.server";
import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import { traegerPageSeed } from "~/lib/traeger/page-seed.server";
import TraegerMensaPage from "./page-content";

export default function Page() {
  const { seed, claims } = traegerPageSeed([careMealTariffs]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <TraegerMensaPage />
      </SWRServerSeed>
    </Suspense>
  );
}
