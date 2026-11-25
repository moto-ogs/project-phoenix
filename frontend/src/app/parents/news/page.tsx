import { messageBoundary } from "~/i18n/scoped-messages";
import { Suspense } from "react";
import { ParentNewsPage } from "~/components/parent/news/parent-news-page";

const PageMessages = messageBoundary(
  "parentDashboard",
  "parentDeclaration",
  "parentNav",
  "parentNews",
  "surveyForm",
);

export default function ParentsNewsPage() {
  return (
    <PageMessages>
      <Suspense>
        <ParentNewsPage />
      </Suspense>
    </PageMessages>
  );
}
