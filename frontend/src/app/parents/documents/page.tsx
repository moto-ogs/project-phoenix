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
      <ParentDocumentsPage />
    </PageMessages>
  );
}
