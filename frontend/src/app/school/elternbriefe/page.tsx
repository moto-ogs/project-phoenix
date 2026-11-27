import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import {
  schoolPageSeed,
  schoolLetters,
  schoolClasses,
} from "~/lib/school/page-seed.server";
import SchoolParentLettersPage from "./page-content";

export default function Page() {
  const { seed, claims } = schoolPageSeed([schoolLetters, schoolClasses]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <SchoolParentLettersPage />
      </SWRServerSeed>
    </Suspense>
  );
}
