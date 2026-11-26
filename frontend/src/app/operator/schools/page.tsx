import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import {
  operatorPageSeed,
  organizations,
} from "~/lib/operator/page-seed.server";
import OperatorSchoolsPage from "./page-content";

export default function Page() {
  const { seed, claims } = operatorPageSeed([organizations]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <OperatorSchoolsPage />
      </SWRServerSeed>
    </Suspense>
  );
}
