import { sepaImportLog } from "~/lib/traeger/administration-seed-reads.server";
import { sepaCreditor } from "~/lib/traeger/billing-seed-reads.server";
import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import { traegerPageSeed } from "~/lib/traeger/page-seed.server";
import TraegerSepaImportPage from "./page-content";

export default function Page() {
  const { seed, claims } = traegerPageSeed([
    { ...sepaImportLog, permission: "traeger_billing:manage" },
    { ...sepaCreditor, permission: "traeger_billing:manage" },
  ]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <TraegerSepaImportPage />
      </SWRServerSeed>
    </Suspense>
  );
}
