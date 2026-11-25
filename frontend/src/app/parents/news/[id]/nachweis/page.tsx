import { messageBoundary } from "~/i18n/scoped-messages";
import { Suspense, use } from "react";
import { DeclarationProofPage } from "~/components/parent/news/declaration-proof-page";
import { ParentPageSkeleton } from "~/components/parent/parent-page";

const PageMessages = messageBoundary(
  "parentChildDetail.guardians.roles",
  "parentDeclaration",
  "parentDeclarationProof",
  "parentNav",
);

/** Nachweis einer Erklärung (#3430) für ein Kind, zum Ansehen und Drucken. */
export default function ParentDeclarationProofPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <PageMessages>
      <Suspense fallback={<ParentPageSkeleton rows={2} />}>
        <DeclarationProofPage announcementId={id} />
      </Suspense>
    </PageMessages>
  );
}
