import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import {
  operatorPageSeed,
  operatorInvitations,
} from "~/lib/operator/page-seed.server";
import OperatorOperatorsPage from "./page-content";

export default function Page() {
  const { seed, claims } = operatorPageSeed([operatorInvitations]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <OperatorOperatorsPage />
      </SWRServerSeed>
    </Suspense>
  );
}
