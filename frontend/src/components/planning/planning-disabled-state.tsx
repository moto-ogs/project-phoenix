import type { ReactNode } from "react";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import { TenantPage } from "~/components/ui/tenant-page";
import { closingDaysConcept } from "~/lib/concepts/closingDays";

interface PlanningDisabledStateProps {
  readonly pageTitle: string;
  readonly heading: string;
  readonly description: string;
  readonly testId: string;
  /** Info-Knopf am Titel, wie auf der eingeschalteten Seite. */
  readonly info?: ReactNode;
}

/**
 * Abgeschalteter Planungsbereich. Auch dieser Zustand rendert das
 * Seitengerüst: Kopfkarte mit dem Seitentitel, darunter der Leerzustand des
 * Gerüsts. Die Erklärung steht im Leerzustand, nicht als Erklärsatz in der
 * Statuszeile — dort gehören nur Zahlen hin.
 */
export function PlanningDisabledState({
  pageTitle,
  heading,
  description,
  testId,
  info,
}: PlanningDisabledStateProps) {
  return (
    <TenantPage
      title={pageTitle}
      info={info}
      testId={testId}
      empty={{
        title: heading,
        description,
        icon: <MotoConceptIcon concept={closingDaysConcept} size={42} />,
      }}
    />
  );
}
