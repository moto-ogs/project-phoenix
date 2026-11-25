import { contractImportLog } from "~/lib/traeger/administration-seed-reads.server";
import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import { traegerPageSeed } from "~/lib/traeger/page-seed.server";
import TraegerContractImportPage from "./page-content";

export default function Page() {
  const { seed, claims } = traegerPageSeed([
    { ...contractImportLog, permission: "traeger_contracts:manage" },
  ]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <TraegerContractImportPage />
      </SWRServerSeed>
    </Suspense>
  );
}
