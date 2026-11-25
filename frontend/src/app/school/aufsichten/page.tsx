import { Suspense } from "react";
import { SchoolSupervisionServerSeed } from "~/components/school/supervisions/school-supervision-server-seed";
import { SchoolSupervisionsView } from "~/components/school/supervisions/supervisions-view";
import { schoolSupervisions } from "~/lib/school/page-seed.server";

export default function Page() {
  const { seed, listKey } = schoolSupervisions();
  return (
    <Suspense fallback={null}>
      <SchoolSupervisionServerSeed seed={seed} listKey={listKey}>
        <SchoolSupervisionsView />
      </SchoolSupervisionServerSeed>
    </Suspense>
  );
}
