import { Suspense } from "react";
import { ParentPageSeed } from "~/app/parents/parent-page-seed";
import { ParentGroupThreadView } from "~/components/parent/messages/group-thread-view";
import { ParentPageSkeleton } from "~/components/parent/parent-page";

export default async function ParentGroupThreadPage({
  params,
}: {
  readonly params: Promise<{ groupThreadId: string }>;
}) {
  const { groupThreadId } = await params;
  return (
    <Suspense fallback={<ParentPageSkeleton rows={2} />}>
      <ParentPageSeed page={{ kind: "groupThread" }}>
        <ParentGroupThreadView groupThreadId={groupThreadId} />
      </ParentPageSeed>
    </Suspense>
  );
}
