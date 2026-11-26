import type {
  TraegerDayClosing,
  TraegerDayOpening,
  TraegerSchoolDayChanges,
} from "./traeger-day-changes-api";

// Die Texte von „Heute anders“ im Träger-Portal (#7672, #8146). Nur Zahlen,
// Uhrzeiten und der Name eines Schließtags, nie eine Person oder ein Grund.

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

/** „8:00“ aus „08:00“. */
function clockTime(value: string): string {
  return value.replace(/^0(\d)/, "$1");
}

/** „8:00 bis 12:30 Uhr“, „8:00 bis 12:30 Uhr, seit 9.7., bis 11.7.“. */
export function openingChangeText(opening: TraegerDayOpening): string {
  const parts = [
    `${clockTime(opening.opensAt)} bis ${clockTime(opening.closesAt)} Uhr`,
  ];
  if (opening.since) parts.push(`seit ${shortDay(opening.since)}`);
  if (opening.until) parts.push(`bis ${shortDay(opening.until)}`);
  return parts.join(", ");
}

/** „1 Raum gesperrt“, „2 Räume gesperrt“. */
export function closedRoomsText(count: number): string {
  return count === 1 ? "1 Raum gesperrt" : `${count} Räume gesperrt`;
}

/** „1 Termin abgesagt“, „3 Termine abgesagt“. */
export function cancelledBlocksText(count: number): string {
  return count === 1 ? "1 Termin abgesagt" : `${count} Termine abgesagt`;
}

/** Ob eine Schule heute einen Eintrag hat. */
export function hasDayChange(school: TraegerSchoolDayChanges): boolean {
  return (
    school.closingDays.length > 0 ||
    school.cancelledBlocks > 0 ||
    school.openingChanges.length > 0 ||
    school.mealCancelled ||
    school.closedRooms > 0
  );
}
