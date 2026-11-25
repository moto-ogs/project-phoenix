import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import {
  operatorPageSeed,
  organizations,
  accountsForQuery,
  type OperatorQuery,
} from "~/lib/operator/page-seed.server";
import OperatorAccountsPage from "./page-content";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<OperatorQuery>;
}) {
  const { seed, claims } = operatorPageSeed([
    organizations,
    accountsForQuery(await searchParams),
  ]);

  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <OperatorAccountsPage />
      </SWRServerSeed>
    </Suspense>
  );
}
