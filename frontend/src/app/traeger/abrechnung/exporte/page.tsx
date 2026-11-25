import { Suspense } from "react";
import {
  datevFirstPageRuns,
  exportRuns,
  exportProtocol,
} from "~/lib/traeger/administration-seed-reads.server";
import {
  exportRecipients,
  exportSettings,
} from "~/lib/traeger/billing-seed-reads.server";
import { traegerPageSeed } from "~/lib/traeger/page-seed.server";
import { FinanceExportSeed } from "./finance-export-seed";
import TraegerFinanceExportsPage from "./page-content";

export default function Page() {
  const firstPage = exportRuns();
  const { seed, claims } = traegerPageSeed(
    [
      firstPage,
      exportProtocol(),
      exportSettings,
      { ...exportRecipients, render: false },
    ],
    async (token) => {
      const [runs, settings] = await Promise.all([
        firstPage.load(token),
        exportSettings.load(token),
      ]);
      return runs && settings?.datev.ready
        ? [datevFirstPageRuns(runs.items)]
        : [];
    },
  );
  return (
    <Suspense fallback={null}>
      <FinanceExportSeed seed={seed} claims={claims}>
        <TraegerFinanceExportsPage />
      </FinanceExportSeed>
    </Suspense>
  );
}
