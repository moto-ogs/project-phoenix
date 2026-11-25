import { Suspense } from "react";
import { ChildProfileMessages } from "~/i18n/shared-page-messages";
import { ChildPage } from "~/components/parent/child/child-page";
import { ParentPageSkeleton } from "~/components/parent/parent-page";
import { ParentServerSeed } from "~/components/parent/parent-server-seed";
import { loadParentPageSeed } from "~/lib/parent-seed.server";

const CHILD_SEED_DETAILS = ["features", "today"] as const;

/**
 * Derselbe Kinderbereich, mit dem Kind aus der Adresse vorausgewaehlt. Die
 * Kinderliste und der Tagesstatus kommen vom Server (#8077); fuer ein Kind,
 * das die Liste nicht nennt, liest er nichts weiter.
 */
export default async function ParentChildPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const seed = loadParentPageSeed({ kind: "child", studentId: id }).catch(
    () => null,
  );
  return (
    <ChildProfileMessages>
      <Suspense fallback={<ParentPageSkeleton rows={2} />}>
        <ParentServerSeed seed={seed} details={CHILD_SEED_DETAILS} render>
          <ChildPage studentId={id} />
        </ParentServerSeed>
      </Suspense>
    </ChildProfileMessages>
  );
}
