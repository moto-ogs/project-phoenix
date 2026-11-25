import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import {
  schoolPageSeed,
  schoolClasses,
  schoolNotices,
} from "~/lib/school/page-seed.server";
import SchoolHomePage from "./page-content";

export default function Page() {
  const { seed, claims } = schoolPageSeed([schoolClasses, schoolNotices]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <SchoolHomePage />
      </SWRServerSeed>
    </Suspense>
  );
}
