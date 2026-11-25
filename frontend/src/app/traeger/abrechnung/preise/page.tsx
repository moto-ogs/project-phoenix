import {
  careTariffs,
  careRules,
} from "~/lib/traeger/billing-seed-reads.server";
import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import { traegerPageSeed } from "~/lib/traeger/page-seed.server";
import TraegerPreislistePage from "./page-content";

export default function Page() {
  const { seed, claims } = traegerPageSeed([careTariffs, careRules]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <TraegerPreislistePage />
      </SWRServerSeed>
    </Suspense>
  );
}
