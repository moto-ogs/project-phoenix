import { ParentMealPlanPage } from "~/components/parent/parent-meal-plan-page";

interface PageProps {
  // `?week=<Montag>` öffnet die Woche eines Hinweises aus der Glocke (#7145).
  readonly searchParams: Promise<{ week?: string | string[] }>;
}

export default async function ParentsMealPlanPage({ searchParams }: PageProps) {
  const { week } = await searchParams;
  return (
    <ParentMealPlanPage
      initialWeek={typeof week === "string" ? week : undefined}
    />
  );
}
