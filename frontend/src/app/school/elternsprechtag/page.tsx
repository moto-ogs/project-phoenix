import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import {
  schoolPageSeed,
  schoolConferences,
} from "~/lib/school/page-seed.server";
import SchoolParentConferencePage from "./page-content";

export default function Page() {
  const { seed, claims } = schoolPageSeed([schoolConferences]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <SchoolParentConferencePage />
      </SWRServerSeed>
    </Suspense>
  );
}
