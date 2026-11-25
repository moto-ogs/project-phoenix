import { Suspense } from "react";
import { ParentPageSeed } from "~/app/parents/parent-page-seed";
import { ParentPageSkeleton } from "~/components/parent/parent-page";
import ParentConferenceContent from "./conference-content";

export default async function ParentConferencePage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense fallback={<ParentPageSkeleton rows={2} />}>
      <ParentPageSeed page={{ kind: "conference", studentId: id }}>
        <ParentConferenceContent params={params} />
      </ParentPageSeed>
    </Suspense>
  );
}
