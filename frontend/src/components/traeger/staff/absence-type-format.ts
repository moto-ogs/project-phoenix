// Texte zu den Abwesenheitsarten und Kontingenten des Trägers (#4710).

import { carryoverRuleLabel, formatDayCount } from "~/lib/absence-helpers";
import type {
  TraegerAbsenceType,
  TraegerAbsenceTypeSchool,
} from "~/lib/traeger-absence-api";
import type { StatusBadgeTone } from "~/components/ui/status-badge";

/** Eine Zeile unter dem Namen: was die Art regelt. */
export function absenceTypeSummary(type: TraegerAbsenceType): string {
  const parts = type.allowanceEnabled
    ? [
        `${formatDayCount(type.standardDays)} pro Person und Jahr`,
        carryoverRuleLabel(type.carryoverUntil),
      ]
    : ["Ohne Kontingent"];
  parts.push(
    type.requestable
      ? "Betreuungskräfte beantragen"
      : "Nur die Leitung trägt ein",
  );
  return parts.join(" · ");
}

/** Wie eine Schule die Art führt: angeboten, abweichend oder noch nicht da. */
export function schoolDeviationBadge(
  type: TraegerAbsenceType,
  school: TraegerAbsenceTypeSchool,
): { readonly label: string; readonly tone: StatusBadgeTone } {
  if (!school.carried) {
    return { label: "Noch nicht übernommen", tone: "warning" };
  }
  if (!type.isActive) return { label: "Ausgeschaltet", tone: "gray" };
  if (!school.offered) return { label: "Nicht angeboten", tone: "gray" };
  if (school.schoolLimitDays !== null && type.allowanceEnabled) {
    return {
      label: `Höchstens ${formatDayCount(school.schoolLimitDays)}`,
      tone: "blue",
    };
  }
  return { label: "Angeboten", tone: "green" };
}
