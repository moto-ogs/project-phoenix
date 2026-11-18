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
  TraegerPlanningShift,
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

/** Beginn eines Vorschlags, wenn die Person an der Schule diese Woche noch keine Schicht hat. */
const SUGGESTION_DEFAULT_START = "08:00";

/** Lücke zu einer Schicht davor am selben Tag: Weg und Pause (zählt ab 15 Min.). */
const SUGGESTION_GAP_MINUTES = 30;

/** Ein Teil einer Pause zählt erst ab 15 Minuten, wie im Backend. */
const MINIMUM_BREAK_PART = 15;

const LAST_MINUTE = 23 * 60 + 59;

/** Ein Vorschlag aus dem Arbeitsvertrag für einen Tag an einer Schule (#7381). */
export interface ContractSuggestion {
  readonly schoolId: string;
  readonly schoolName: string;
  /** "YYYY-MM-DD" */
  readonly date: string;
  /** Vorgeschlagene Arbeitszeit, netto: Soll des Tages, höchstens der Rest der Woche. */
  readonly minutes: number;
  /** "HH:MM" */
  readonly startTime: string;
  /** "HH:MM" */
  readonly endTime: string;
  readonly breakMinutes: number;
}

/** Gesetzliche Pause zur Arbeitszeit: über 6 h 30 Min., über 9 h 45 Min. */
function requiredBreak(minutes: number): number {
  if (minutes > 9 * 60) return 45;
  if (minutes > 6 * 60) return 30;
  return 0;
}

function clockToMinutes(clock: string): number {
  const [hours, minutes] = clock.split(":");
  return Number(hours) * 60 + Number(minutes);
}

function minutesToClock(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Ein belegter Zeitraum eines Tages in Minuten, mit seiner Pause. */
interface Busy {
  readonly start: number;
  readonly end: number;
  readonly breakMinutes: number;
}

/**
 * Der übliche Beginn der Person an der Schule: der häufigste Beginn ihrer
 * Schichten dort in der Woche, bei Gleichstand der früheste. Ein einzelner
 * Abendtermin verschiebt so nicht jeden Vorschlag.
 */
function usualStart(shifts: readonly TraegerPlanningShift[]): string {
  const counts = new Map<string, number>();
  for (const shift of shifts) {
    counts.set(shift.startTime, (counts.get(shift.startTime) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [start, count] of counts) {
    const bestCount = best === null ? 0 : (counts.get(best) ?? 0);
    if (
      best === null ||
      count > bestCount ||
      (count === bestCount && start < best)
    ) {
      best = start;
    }
  }
  return best ?? SUGGESTION_DEFAULT_START;
}

/** Schiebt den Beginn hinter jede Überschneidung, mit Lücke für Weg und Pause. */
function freeStart(
  start: number,
  length: number,
  busy: readonly Busy[],
): number {
  let candidate = start;
  for (const slot of busy) {
    if (candidate < slot.end && slot.start < candidate + length) {
      candidate = slot.end + SUGGESTION_GAP_MINUTES;
    }
  }
  return candidate;
}

/** Pausen eines Tages: die eingetragenen und jede Lücke ab 15 Minuten. */
function dayBreaks(busy: readonly Busy[]): number {
  let breaks = 0;
  busy.forEach((slot, index) => {
    breaks += slot.breakMinutes;
    const previous = busy[index - 1];
    if (previous && slot.start - previous.end >= MINIMUM_BREAK_PART) {
      breaks += slot.start - previous.end;
    }
  });
  return breaks;
}

const byStart = (a: Busy, b: Busy) => a.start - b.start;

/**
 * Die Vorschläge des Vertrags für einen Tag: je Schule mit Soll, an der die
 * Person an diesem Tag noch keine Schicht hat und nicht abwesend ist.
 * Vergangene Tage bekommen keinen Vorschlag, und keiner führt über das Soll
 * der Woche.
 *
 * Der Beginn ist der übliche Beginn der Person an dieser Schule in der Woche,
 * sonst 08:00. Liegt dort schon eine Schicht oder ein früherer Vorschlag des
 * Tages, beginnt der Vorschlag 30 Minuten nach deren Ende. Die Pause folgt
 * aus der Arbeitszeit des ganzen Tages an allen Schulen, wie die Prüfung.
 */
export function contractSuggestions(
  person: TraegerPlanningPerson,
  date: string,
  todayIso: string,
): ContractSuggestion[] {
  if (date < todayIso) return [];
  let remaining =
    person.sollMinutes === null
      ? 0
      : person.sollMinutes - person.plannedMinutes;
  const active = person.shifts.filter((shift) => !shift.cancelled);
  const busy: Busy[] = active
    .filter((shift) => shift.date === date)
    .map((shift) => ({
      start: clockToMinutes(shift.startTime),
      end: clockToMinutes(shift.endTime),
      breakMinutes: shift.breakMinutes,
    }))
    .sort(byStart);
  const result: ContractSuggestion[] = [];
  for (const day of person.sollDays) {
    if (remaining <= 0) break;
    if (day.date !== date || day.minutes <= 0) continue;
    const site = person.sites.find((entry) => entry.schoolId === day.schoolId);
    if (!site) continue;
    const absent = person.absentDays.some(
      (entry) => entry.schoolId === day.schoolId && entry.date === date,
    );
    if (absent) continue;
    const atSchool = active.filter((shift) => shift.schoolId === day.schoolId);
    if (atSchool.some((shift) => shift.date === date)) continue;
    const minutes = Math.min(day.minutes, remaining);
    const dayNet = busy.reduce(
      (sum, slot) => sum + slot.end - slot.start - slot.breakMinutes,
      0,
    );
    let breakMinutes = requiredBreak(minutes);
    const start = freeStart(
      clockToMinutes(usualStart(atSchool)),
      minutes + breakMinutes,
      busy,
    );
    // Fehlt dem ganzen Tag noch Pause, trägt dieser Vorschlag den Rest.
    const placed = [
      ...busy,
      { start, end: start + minutes + breakMinutes, breakMinutes },
    ].sort(byStart);
    breakMinutes += Math.max(
      0,
      requiredBreak(dayNet + minutes) - dayBreaks(placed),
    );
    const end = Math.min(start + minutes + breakMinutes, LAST_MINUTE);
    if (end - start - breakMinutes < minutes) continue;
    busy.push({ start, end, breakMinutes });
    busy.sort(byStart);
    remaining -= minutes;
    result.push({
      schoolId: day.schoolId,
      schoolName: site.schoolName,
      date,
      minutes,
      startTime: minutesToClock(start),
      endTime: minutesToClock(end),
      breakMinutes,
    });
  }
  return result;
}
