import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import {
  operatorPageSeed,
  operatorProfile,
  operatorPasskeys,
  operatorTrustedDevices,
} from "~/lib/operator/page-seed.server";
import OperatorSettingsPage from "./page-content";

export default function Page() {
  const { seed, claims } = operatorPageSeed([
    operatorProfile,
    operatorPasskeys,
    operatorTrustedDevices,
  ]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <OperatorSettingsPage />
      </SWRServerSeed>
    </Suspense>
  );
}
