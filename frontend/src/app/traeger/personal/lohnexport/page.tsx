import {
  payrollEmployers,
  settingsSchema,
} from "~/lib/traeger/administration-seed-reads.server";
import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import { traegerPageSeed } from "~/lib/traeger/page-seed.server";
import TraegerPayrollExportPage from "./page-content";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { tab: rawTab } = await searchParams;
  const tab = Array.isArray(rawTab) ? rawTab[0] : rawTab;
  const { seed, claims } = traegerPageSeed([
    settingsSchema,
    ...(tab === "einrichtung" || tab === "lohnarten" ? [payrollEmployers] : []),
  ]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <TraegerPayrollExportPage />
      </SWRServerSeed>
    </Suspense>
  );
}
