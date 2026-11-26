import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import {
  operatorPageSeed,
  devicesForQuery,
  organizations,
  type OperatorQuery,
} from "~/lib/operator/page-seed.server";
import OperatorDevicesPage from "./page-content";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<OperatorQuery>;
}) {
  const query = await searchParams;
  const { seed, claims } = operatorPageSeed([
    organizations,
    devicesForQuery(query),
  ]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <OperatorDevicesPage />
      </SWRServerSeed>
    </Suspense>
  );
}
