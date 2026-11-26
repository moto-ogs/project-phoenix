import { debtorNumberSettings } from "~/lib/traeger/administration-seed-reads.server";
import { billingTerms } from "~/lib/traeger/billing-seed-reads.server";
import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import { traegerPageSeed } from "~/lib/traeger/page-seed.server";
import TraegerFamilyPaymentPage from "./page-content";

export default function Page() {
  const { seed, claims } = traegerPageSeed([
    debtorNumberSettings,
    billingTerms,
  ]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <TraegerFamilyPaymentPage />
      </SWRServerSeed>
    </Suspense>
  );
}
