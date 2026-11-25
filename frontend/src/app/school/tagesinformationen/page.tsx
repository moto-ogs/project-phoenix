import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import { schoolPageSeed, schoolNotices } from "~/lib/school/page-seed.server";
import SchoolNoticesPage from "./page-content";

export default function Page() {
  const { seed, claims } = schoolPageSeed([schoolNotices]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <SchoolNoticesPage />
      </SWRServerSeed>
    </Suspense>
  );
}
