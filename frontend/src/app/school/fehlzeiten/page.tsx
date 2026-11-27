import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import { schoolPageSeed, schoolClasses } from "~/lib/school/page-seed.server";
import SchoolAbsenceListPage from "./page-content";

export default function Page() {
  const { seed, claims } = schoolPageSeed([schoolClasses]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <SchoolAbsenceListPage />
      </SWRServerSeed>
    </Suspense>
  );
}
