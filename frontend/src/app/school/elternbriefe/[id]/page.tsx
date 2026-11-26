import { Suspense } from "react";
import { schoolLetterDetail } from "~/lib/school/page-seed.server";
import { LetterSeed } from "./letter-seed";
import SchoolParentLetterPage from "./page-content";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { seed, claims } = schoolLetterDetail(id);
  return (
    <Suspense fallback={null}>
      <LetterSeed id={id} seed={seed} claims={claims}>
        <SchoolParentLetterPage />
      </LetterSeed>
    </Suspense>
  );
}
