import { Suspense } from "react";
import { ChildProfileMessages } from "~/i18n/shared-page-messages";
import { ChildPage } from "~/components/parent/child/child-page";
import { ParentPageSkeleton } from "~/components/parent/parent-page";
import { ParentPageSeed } from "~/app/parents/parent-page-seed";

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
  return (
    <ChildProfileMessages>
      <Suspense fallback={<ParentPageSkeleton rows={2} />}>
        <ParentPageSeed page={{ kind: "child", studentId: id }}>
          <ChildPage studentId={id} />
        </ParentPageSeed>
      </Suspense>
    </ChildProfileMessages>
  );
}
