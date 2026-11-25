import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import { schoolPageSeed, schoolInbox } from "~/lib/school/page-seed.server";
import SchoolMessagesPage from "./page-content";

export default function Page() {
  const { seed, claims } = schoolPageSeed([schoolInbox]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <SchoolMessagesPage />
      </SWRServerSeed>
    </Suspense>
  );
}
