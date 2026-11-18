import { ParentMealPlanPage } from "~/components/parent/parent-meal-plan-page";

interface PageProps {
  // `?week=<Montag>&school=<id>` öffnet die Woche eines Hinweises aus der
  // Glocke an der betroffenen Schule (#7145).
  readonly searchParams: Promise<{
    week?: string | string[];
    school?: string | string[];
  }>;
}

export default async function ParentsMealPlanPage({ searchParams }: PageProps) {
  const { week, school } = await searchParams;
  return (
    <ParentMealPlanPage
      initialWeek={typeof week === "string" ? week : undefined}
      initialSchool={typeof school === "string" ? school : undefined}
    />
  );
}
