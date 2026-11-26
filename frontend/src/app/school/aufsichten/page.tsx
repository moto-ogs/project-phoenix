import { connection } from "next/server";
import { Suspense } from "react";
import { SchoolSupervisionServerSeed } from "~/components/school/supervisions/school-supervision-server-seed";
import { SchoolSupervisionsView } from "~/components/school/supervisions/supervisions-view";
import { schoolSupervisions } from "~/lib/school/page-seed.server";

export default async function Page() {
  await connection();
  const { seed, listKey } = schoolSupervisions();
  return (
    <Suspense fallback={null}>
      <SchoolSupervisionServerSeed seed={seed} listKey={listKey}>
        <SchoolSupervisionsView />
      </SchoolSupervisionServerSeed>
    </Suspense>
  );
}
