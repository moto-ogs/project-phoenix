import { messageBoundary } from "~/i18n/scoped-messages";
import { Suspense } from "react";
import { ParentPageSeed } from "~/app/parents/parent-page-seed";
import { DeclarationProofPage } from "~/components/parent/news/declaration-proof-page";
import { ParentPageSkeleton } from "~/components/parent/parent-page";

const PageMessages = messageBoundary(
  "parentChildDetail.guardians.roles",
  "parentDeclaration",
  "parentDeclarationProof",
  "parentNav",
);

/** Nachweis einer Erklärung (#3430) für ein Kind, zum Ansehen und Drucken. */
export default async function ParentDeclarationProofPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ student?: string | string[] }>;
}) {
  const [{ id }, { student }] = await Promise.all([params, searchParams]);
  const studentId = Array.isArray(student)
    ? (student[0] ?? "")
    : (student ?? "");
  return (
    <PageMessages>
      <Suspense fallback={<ParentPageSkeleton rows={2} />}>
        <ParentPageSeed page={{ kind: "proof", announcementId: id, studentId }}>
          <DeclarationProofPage announcementId={id} />
        </ParentPageSeed>
      </Suspense>
    </PageMessages>
  );
}
