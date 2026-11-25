import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import {
  operatorPageSeed,
  organizationSummaries,
  provisioningStats,
} from "~/lib/operator/page-seed.server";
import OperatorOrganizationsPage from "./page-content";

export default function Page() {
  const { seed, claims } = operatorPageSeed([
    organizationSummaries,
    { ...provisioningStats, render: false },
  ]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <OperatorOrganizationsPage />
      </SWRServerSeed>
    </Suspense>
  );
}
