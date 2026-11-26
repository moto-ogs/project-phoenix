import type {
  TraegerDayClosing,
  TraegerSchoolDayChanges,
} from "./traeger-day-changes-api";

// Die Texte von „Heute anders“ im Träger-Portal (#7672). Nur Zahlen und
// der Name eines Schließtags, nie eine Person oder ein Grund.

/** „3.11.“ aus „2026-11-03“. */
function shortDay(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${Number(day)}.${Number(month)}.`;
}

/** „Schließtag der Schule: Studientag“, „Schließtag des Trägers: …“. */
export function closingDayLabel(closing: TraegerDayClosing): string {
  return closing.traeger ? "Schließtag des Trägers" : "Schließtag der Schule";
}

/** „Studientag“, „Betriebsausflug, seit 9.7., bis 11.7.“. */
export function closingDayText(closing: TraegerDayClosing): string {
  const parts = [closing.name.trim()];
  if (closing.since) parts.push(`seit ${shortDay(closing.since)}`);
  if (closing.until) parts.push(`bis ${shortDay(closing.until)}`);
  return parts.join(", ");
}

/** „1 Termin abgesagt“, „3 Termine abgesagt“. */
export function cancelledBlocksText(count: number): string {
  return count === 1 ? "1 Termin abgesagt" : `${count} Termine abgesagt`;
}

/** Ob eine Schule heute einen Eintrag hat. */
export function hasDayChange(school: TraegerSchoolDayChanges): boolean {
  return school.closingDays.length > 0 || school.cancelledBlocks > 0;
}
