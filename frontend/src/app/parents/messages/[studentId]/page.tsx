import { Suspense } from "react";
import { ParentPageSkeleton } from "~/components/parent/parent-page";
import { ParentPageSeed } from "~/app/parents/parent-page-seed";
import { ParentChildConversationContent } from "./conversation-content";

export default async function ParentChildConversationPage({
  params,
}: {
  readonly params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;
  return (
    <Suspense fallback={<ParentPageSkeleton rows={1} />}>
      <ParentPageSeed page={{ kind: "conversation", studentId }}>
        <ParentChildConversationContent studentId={studentId} />
      </ParentPageSeed>
    </Suspense>
  );
}
