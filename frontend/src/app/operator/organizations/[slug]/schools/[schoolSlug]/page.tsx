import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import {
  operatorPageSeed,
  organizationSummaries,
} from "~/lib/operator/page-seed.server";
import OperatorSchoolDetailPage from "./page-content";

export default function Page({
  params,
}: {
  params: Promise<{ slug: string; schoolSlug: string }>;
}) {
  const { seed, claims } = operatorPageSeed([organizationSummaries]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <OperatorSchoolDetailPage params={params} />
      </SWRServerSeed>
    </Suspense>
  );
}
