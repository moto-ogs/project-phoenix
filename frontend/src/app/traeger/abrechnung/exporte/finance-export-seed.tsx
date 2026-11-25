"use client";

import type { ReactNode } from "react";
import { SWRServerSeed, type ServerSeedInput } from "~/lib/swr/server-seed";
import { traegerBillingKeys } from "~/lib/swr/traeger-billing-keys";
import {
  datevRunKey,
  type FinanceExportRunPage,
} from "~/lib/traeger-finance-exports-api";

const RUNS_KEY = traegerBillingKeys.exportRuns();

export function FinanceExportSeed({
  seed,
  claims,
  children,
}: Readonly<{
  seed: ServerSeedInput;
  claims: readonly string[];
  children: ReactNode;
}>) {
  return (
    <SWRServerSeed
      seed={seed}
      claims={claims}
      claimsFrom={{
        key: RUNS_KEY,
        derive: (runs: FinanceExportRunPage) => [
          traegerBillingKeys.datevRuns(runs.items.map(datevRunKey)),
        ],
      }}
      render
    >
      {children}
    </SWRServerSeed>
  );
}
