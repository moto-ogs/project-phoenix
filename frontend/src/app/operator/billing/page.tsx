import { Suspense } from "react";
import { berlinTodayISO } from "~/lib/date-helpers";
import {
  billingCounts,
  billingKeyDay,
  operatorPageSeed,
  organizations,
} from "~/lib/operator/page-seed.server";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import OperatorBillingPage from "./page-content";

export default function Page() {
  const period = `${berlinTodayISO().slice(0, 8)}01`;
  const { seed, claims } = operatorPageSeed([
    billingKeyDay,
    billingCounts,
    {
      ...organizations,
      load: async (token) =>
        (await billingCounts.load(token))?.[0]?.period === period
          ? organizations.load(token)
          : undefined,
      render: false,
    },
  ]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <OperatorBillingPage />
      </SWRServerSeed>
    </Suspense>
  );
}
