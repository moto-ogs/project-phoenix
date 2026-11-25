import { ParentPageSkeleton } from "~/components/parent/parent-page";
import { Suspense } from "react";
import { ParentPageSeed } from "~/app/parents/parent-page-seed";
import { messageBoundary } from "~/i18n/scoped-messages";
import { ParentDocumentsPage } from "~/components/parent/parent-documents-page";

const PageMessages = messageBoundary(
  "parentDocuments",
  "parentFamilyChildren",
  "parentNav",
  "parentSepaMandate",
);

export default function ParentsDocumentsPage() {
  return (
    <PageMessages>
      <Suspense fallback={<ParentPageSkeleton rows={2} />}>
        <ParentPageSeed page={{ kind: "documents" }}>
          <ParentDocumentsPage />
        </ParentPageSeed>
      </Suspense>
    </PageMessages>
  );
}
