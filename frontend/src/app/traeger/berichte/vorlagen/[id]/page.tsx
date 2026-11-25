import { reportTemplates } from "~/lib/traeger/metrics-seed-reads.server";
import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import {
  traegerPageSeed,
  traegerSchools,
} from "~/lib/traeger/page-seed.server";
import EditReportTemplatePage from "./page-content";

export default function Page() {
  const { seed, claims } = traegerPageSeed([reportTemplates, traegerSchools]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <EditReportTemplatePage />
      </SWRServerSeed>
    </Suspense>
  );
}
