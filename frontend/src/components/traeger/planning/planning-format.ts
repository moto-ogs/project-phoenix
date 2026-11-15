/**
 * Darstellung der Einsatzplanung des Trägers (#4708): Farbe je Schule,
 * Tage der Woche, Stunden und die Regeln in einem Satz. Rein und ohne
 * Daten-Laden, damit Raster, Dialog und Tests dieselben Werte nutzen.
 */
import { formatWeekLabel, parseISODate, toISODate } from "~/lib/date-helpers";
import { LOCATION_COLORS } from "~/lib/location-helper";
import { formatPlannedHours } from "~/lib/shift-helpers";
import type {
  TraegerPlanningPerson,
  TraegerPlanningRules,
  TraegerPlanningSchool,
} from "~/lib/traeger-planning-api";
import type { WorkingTimeWarning } from "~/lib/working-time";

/**
 * Farben der Schulen, in dieser Reihenfolge vergeben. Rot und Gelb fehlen
 * bewusst: Sie bedeuten im Plan Abwesenheit und Hinweis.
 */
const SCHOOL_COLORS = [
  LOCATION_COLORS.OTHER_ROOM,
  LOCATION_COLORS.AT_SCHOOL,
  LOCATION_COLORS.EXCUSED,
  LOCATION_COLORS.SCHOOLYARD,
  LOCATION_COLORS.CLASS_TRIP,
  LOCATION_COLORS.NOT_ARRIVAL,
  LOCATION_COLORS.TRANSIT,
  LOCATION_COLORS.GROUP_ROOM,
] as const;

/** Schul-ID → Farbe, stabil in der Reihenfolge der Schulen des Trägers. */
export function schoolColors(
  schools: readonly TraegerPlanningSchool[],
): Map<string, string> {
  return new Map(
    schools.map((school, index) => [
      school.id,
      SCHOOL_COLORS[index % SCHOOL_COLORS.length] ?? LOCATION_COLORS.UNKNOWN,
    ]),
  );
}

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;

/** Montag der Woche, in der `iso` liegt. */
export function mondayOf(iso: string): string {
  const day = parseISODate(iso);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return toISODate(day);
}

export function addDaysISO(iso: string, days: number): string {
  const day = parseISODate(iso);
  day.setDate(day.getDate() + days);
  return toISODate(day);
}

export interface PlanningDay {
  /** "YYYY-MM-DD" */
  readonly date: string;
  /** "Mo" */
  readonly weekday: string;
  /** "23.11." */
  readonly label: string;
}

/**
 * Montag bis Freitag; Samstag und Sonntag nur, wenn in der Woche dort eine
 * Schicht liegt.
 */
export function planningDays(
  monday: string,
  people: readonly TraegerPlanningPerson[],
): PlanningDay[] {
  const all = WEEKDAYS.map((weekday, index) => {
    const date = addDaysISO(monday, index);
    const [, month, day] = date.split("-");
    return { date, weekday, label: `${day}.${month}.` };
  });
  const weekendUsed = people.some((person) =>
    person.shifts.some((shift) => shift.date >= all[5]!.date),
  );
  return weekendUsed ? all : all.slice(0, 5);
}

/** „KW 48 · 23.11.–29.11.2026“ */
export function planningWeekLabel(monday: string): string {
  return formatWeekLabel(
    parseISODate(monday),
    parseISODate(addDaysISO(monday, 6)),
  );
}

/** „18,5/24 h“ mit Soll, „18,5 h“ ohne. */
export function plannedOfSoll(person: TraegerPlanningPerson): string {
  const planned = formatPlannedHours(person.plannedMinutes);
  if (person.sollMinutes === null) return planned;
  return `${planned.replace(/\s*h$/, "")}/${formatPlannedHours(person.sollMinutes)}`;
}

/** Ton des Soll-Vergleichs, wie im Dienstplan der Schule. */
export function sollTone(
  person: TraegerPlanningPerson,
): "neutral" | "under" | "over" {
  if (person.sollMinutes === null) return "neutral";
  if (person.plannedMinutes < person.sollMinutes) return "under";
  if (person.plannedMinutes > person.sollMinutes) return "over";
  return "neutral";
}

/** Die Regeln in einer Zeile: „Höchstens 10 h am Tag · 11 h Ruhezeit · Pausen“. */
export function rulesSummary(rules: TraegerPlanningRules): string[] {
  const parts: string[] = [];
  parts.push(
    rules.maxDailyMinutes > 0
      ? `Höchstens ${formatPlannedHours(rules.maxDailyMinutes)} am Tag`
      : "Ohne Tageshöchstzeit",
  );
  parts.push(`${formatPlannedHours(rules.minRestMinutes)} Ruhezeit`);
  parts.push(rules.checkBreaks ? "Pausen geprüft" : "Pausen nicht geprüft");
  return parts;
}

/** Hinweise eines Tages; die Wochen-Hinweise (Soll) zählen nicht dazu. */
export function warningsOfDay(
  warnings: readonly WorkingTimeWarning[],
  date: string,
): WorkingTimeWarning[] {
  return warnings.filter(
    (warning) => warning.kind !== "above_soll" && warning.date === date,
  );
}
