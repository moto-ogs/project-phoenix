import {
  documentKinds,
  billingIssuers,
} from "~/lib/traeger/billing-seed-reads.server";
import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import { traegerPageSeed } from "~/lib/traeger/page-seed.server";
import TraegerDocumentKindsPage from "./page-content";

export default function Page() {
  const { seed, claims } = traegerPageSeed([
    { ...documentKinds, permission: "traeger_billing:manage" },
    { ...billingIssuers, permission: "traeger_billing:manage" },
  ]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <TraegerDocumentKindsPage />
      </SWRServerSeed>
    </Suspense>
  );
}
