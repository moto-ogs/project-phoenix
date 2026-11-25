import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import {
  careNumberRange,
  holidayNumberRange,
  issuerNumberRanges,
  settingsSchema,
} from "~/lib/traeger/administration-seed-reads.server";
import {
  billingIssuers,
  billingTerms,
  contributionRules,
  costBearers,
  sepaCreditor,
} from "~/lib/traeger/billing-seed-reads.server";
import { traegerPageSeed } from "~/lib/traeger/page-seed.server";
import TraegerAbrechnungsvorgabenPage from "./page-content";

const BILLING_DEFAULTS = [
  contributionRules,
  costBearers,
  holidayNumberRange,
  careNumberRange,
  billingTerms,
  sepaCreditor,
].map((read) => ({
  ...read,
  module: "elternbeitraege" as const,
  permission: "traeger_billing:manage",
}));

export default function Page() {
  const { seed, claims } = traegerPageSeed([
    settingsSchema,
    ...BILLING_DEFAULTS,
    {
      ...billingIssuers,
      module: "elternbeitraege",
      permission: "traeger_billing:manage",
      render: false,
    },
    {
      ...issuerNumberRanges,
      module: "elternbeitraege",
      permission: "traeger_billing:manage",
      after: async (token) =>
        ((await billingIssuers.load(token))?.length ?? 0) > 0,
      render: false,
    },
  ]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <TraegerAbrechnungsvorgabenPage />
      </SWRServerSeed>
    </Suspense>
  );
}
