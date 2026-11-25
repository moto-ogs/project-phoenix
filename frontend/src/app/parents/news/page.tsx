import { ParentPageSkeleton } from "~/components/parent/parent-page";
import { ParentPageSeed } from "~/app/parents/parent-page-seed";
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
      <Suspense fallback={<ParentPageSkeleton rows={2} />}>
        <ParentPageSeed page={{ kind: "news" }}>
          <ParentNewsPage />
        </ParentPageSeed>
      </Suspense>
    </PageMessages>
  );
}
