import { settingsSchema } from "~/lib/traeger/administration-seed-reads.server";
import { masterData } from "~/lib/traeger/settings-seed-reads.server";
import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import { traegerPageSeed } from "~/lib/traeger/page-seed.server";
import TraegerBriefkopfPage from "./page-content";

export default function Page() {
  const { seed, claims } = traegerPageSeed([settingsSchema, masterData]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <TraegerBriefkopfPage />
      </SWRServerSeed>
    </Suspense>
  );
}
