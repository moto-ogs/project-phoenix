import { ParentPageSkeleton } from "~/components/parent/parent-page";
import { Suspense } from "react";
import { ParentPageSeed } from "~/app/parents/parent-page-seed";
import { messageBoundary } from "~/i18n/scoped-messages";
import { ParentMealPlanPage } from "~/components/parent/parent-meal-plan-page";

interface PageProps {
  // `?week=<Montag>&school=<id>` öffnet die Woche eines Hinweises aus der
  // Glocke an der betroffenen Schule (#7145).
  readonly searchParams: Promise<{
    week?: string | string[];
    school?: string | string[];
  }>;
}

const PageMessages = messageBoundary(
  "mealAllergens",
  "parentMealPlan",
  "parentNav",
);

export default async function ParentsMealPlanPage({ searchParams }: PageProps) {
  const { week, school } = await searchParams;
  const initialWeek = typeof week === "string" ? week : undefined;
  const initialSchool = typeof school === "string" ? school : undefined;
  return (
    <PageMessages>
      <Suspense fallback={<ParentPageSkeleton rows={2} />}>
        <ParentPageSeed
          page={{ kind: "meal", week: initialWeek, school: initialSchool }}
        >
          <ParentMealPlanPage
            initialWeek={initialWeek}
            initialSchool={initialSchool}
          />
        </ParentPageSeed>
      </Suspense>
    </PageMessages>
  );
}
