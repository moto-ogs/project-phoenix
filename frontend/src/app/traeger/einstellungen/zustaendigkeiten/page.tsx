import { settingsSchema } from "~/lib/traeger/administration-seed-reads.server";
import { billingIssuers } from "~/lib/traeger/billing-seed-reads.server";
import { responsibilities } from "~/lib/traeger/settings-seed-reads.server";
import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import { traegerPageSeed } from "~/lib/traeger/page-seed.server";
import TraegerResponsibilitiesPage from "./page-content";

export default function Page() {
  const { seed, claims } = traegerPageSeed([
    settingsSchema,
    responsibilities,
    {
      ...billingIssuers,
      after: async (token) =>
        (await responsibilities.load(token)) !== undefined,
      render: false,
    },
  ]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <TraegerResponsibilitiesPage />
      </SWRServerSeed>
    </Suspense>
  );
}
