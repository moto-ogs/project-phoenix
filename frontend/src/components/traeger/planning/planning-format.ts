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

/** Früher als 06:00 schlägt moto keinen Beginn vor. */
const EARLIEST_START = 6 * 60;

/** Ein Vorschlag aus dem Arbeitsvertrag für einen Tag an einer Schule (#7381). */
export interface ContractSuggestion {
  readonly schoolId: string;
  readonly schoolName: string;
  /** "YYYY-MM-DD" */
  readonly date: string;
  /** Soll des Tages an dieser Schule laut Arbeitsvertrag, netto. */
  readonly contractMinutes: number;
  /**
   * Vorgeschlagene Arbeitszeit, netto: das Soll des Tages, höchstens der Rest
   * der Woche und der Höchstzeit am Tag.
   */
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

/** Kürzere Reste der Woche schlägt moto nicht als eigene Schicht vor. */
const MINIMUM_SUGGESTION_MINUTES = 30;

/** Ein belegter Zeitraum eines Tages in Minuten, mit seiner Pause. */
interface Busy {
  readonly start: number;
  readonly end: number;
  readonly breakMinutes: number;
}

const byStart = (a: Busy, b: Busy) => a.start - b.start;

/**
 * Der übliche Beginn der Person an der Schule: der häufigste Beginn ihrer
 * Schichten dort in der Woche, bei Gleichstand der früheste.
 */
function usualStart(shifts: readonly TraegerPlanningShift[]): number | null {
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
  return best === null ? null : clockToMinutes(best);
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

const dayNet = (busy: readonly Busy[]) =>
  busy.reduce(
    (sum, slot) => sum + slot.end - slot.start - slot.breakMinutes,
    0,
  );

/** Hält zu jeder anderen Schicht des Tages 30 Minuten Abstand für Weg und Pause. */
const fitsBetween = (slot: Busy, busy: readonly Busy[]) =>
  slot.start >= EARLIEST_START &&
  slot.end <= LAST_MINUTE &&
  busy.every(
    (other) =>
      slot.end + SUGGESTION_GAP_MINUTES <= other.start ||
      other.end + SUGGESTION_GAP_MINUTES <= slot.start,
  );

/**
 * Legt `minutes` netto in den Tag: ab dem ersten passenden Beginn, mit der
 * Pause, die der ganze Tag an allen Schulen braucht. Fehlt dem Tag Pause,
 * wird der Vorschlag länger, nach hinten oder nach vorn; angenommen wird er
 * nur, wenn die Pause danach wirklich reicht, denn eine längere Schicht
 * verkürzt die Lücke zur nächsten, die selbst als Pause zählt.
 */
function place(
  minutes: number,
  starts: readonly number[],
  busy: readonly Busy[],
): Busy | null {
  const total = dayNet(busy) + minutes;
  const breakShort = (slot: Busy) =>
    requiredBreak(total) - dayBreaks([...busy, slot].sort(byStart));
  for (const start of starts) {
    const own = requiredBreak(minutes);
    const first = { start, end: start + minutes + own, breakMinutes: own };
    if (!fitsBetween(first, busy)) continue;
    const missing = breakShort(first);
    if (missing <= 0) return first;
    const longer = [
      { start, end: first.end + missing, breakMinutes: own + missing },
      { start: start - missing, end: first.end, breakMinutes: own + missing },
    ].find((slot) => fitsBetween(slot, busy) && breakShort(slot) <= 0);
    if (longer) return longer;
  }
  return null;
}

/**
 * Mögliche Anfänge: zuerst der übliche, dann 08:00, dann früh genug vor
 * oder nach jeder Schicht des Tages, der Zeit nach.
 */
function candidateStarts(
  usual: number | null,
  minutes: number,
  busy: readonly Busy[],
): number[] {
  const length = minutes + requiredBreak(minutes);
  const around = busy
    .flatMap((slot) => [
      slot.start - SUGGESTION_GAP_MINUTES - length,
      slot.end + SUGGESTION_GAP_MINUTES,
    ])
    .sort((a, b) => a - b);
  const fallback = clockToMinutes(SUGGESTION_DEFAULT_START);
  return [...new Set([usual ?? fallback, fallback, ...around])];
}

/**
 * Die Vorschläge des Vertrags für die gezeigte Woche, je Tag. Ein Vorschlag
 * entsteht je Tag und Schule mit Soll, an der für die Person an dem Tag
 * noch keine Schicht steht (auch keine abgesagte) und sie nicht abwesend
 * ist. Vergangene Tage bekommen keinen.
 *
 * Die Woche wird einmal von vorn durchgerechnet: Zusammen führen die
 * Vorschläge nie über das Soll der Woche und keiner über die Höchstzeit des
 * Tages; ein Rest unter 30 Minuten bleibt ohne Vorschlag. Der Beginn ist der übliche der Person an dieser Schule,
 * sonst 08:00; passt er nicht, der früheste freie ab 06:00 mit 30 Minuten
 * Abstand zu jeder anderen Schicht, und bis 23:59. Die Pause deckt den ganzen Tag an allen Schulen,
 * wie die Prüfung beim Speichern.
 */
export function weekSuggestions(
  person: TraegerPlanningPerson,
  todayIso: string,
  /** Höchstens so viele Minuten am Tag an allen Schulen; 0 ohne Grenze. */
  maxDailyMinutes = 0,
): Map<string, ContractSuggestion[]> {
  const result = new Map<string, ContractSuggestion[]>();
  if (person.sollMinutes === null) return result;
  let remaining = person.sollMinutes - person.plannedMinutes;
  const usualBySchool = new Map(
    person.sites.map((site) => [
      site.schoolId,
      usualStart(
        person.shifts.filter(
          (shift) => !shift.cancelled && shift.schoolId === site.schoolId,
        ),
      ),
    ]),
  );
  const days = [...new Set(person.sollDays.map((day) => day.date))].sort();
  for (const date of days) {
    if (date < todayIso) continue;
    const busy: Busy[] = person.shifts
      .filter((shift) => !shift.cancelled && shift.date === date)
      .map((shift) => ({
        start: clockToMinutes(shift.startTime),
        end: clockToMinutes(shift.endTime),
        breakMinutes: shift.breakMinutes,
      }))
      .sort(byStart);
    const open = person.sollDays
      .filter(
        (day) =>
          day.date === date &&
          day.minutes > 0 &&
          !person.shifts.some(
            (shift) => shift.date === date && shift.schoolId === day.schoolId,
          ) &&
          !person.absentDays.some(
            (entry) => entry.schoolId === day.schoolId && entry.date === date,
          ),
      )
      // Wer an einer Schule früher anfängt, kommt zuerst in den Tag.
      .sort(
        (a, b) =>
          (usualBySchool.get(a.schoolId) ??
            clockToMinutes(SUGGESTION_DEFAULT_START)) -
          (usualBySchool.get(b.schoolId) ??
            clockToMinutes(SUGGESTION_DEFAULT_START)),
      );
    const suggestions: ContractSuggestion[] = [];
    for (const day of open) {
      const site = person.sites.find(
        (entry) => entry.schoolId === day.schoolId,
      );
      const dayLeft =
        maxDailyMinutes > 0 ? maxDailyMinutes - dayNet(busy) : Infinity;
      const minutes = Math.min(day.minutes, remaining, dayLeft);
      if (!site || minutes < MINIMUM_SUGGESTION_MINUTES) continue;
      const slot = place(
        minutes,
        candidateStarts(usualBySchool.get(day.schoolId) ?? null, minutes, busy),
        busy,
      );
      if (!slot) continue;
      busy.push(slot);
      busy.sort(byStart);
      remaining -= minutes;
      suggestions.push({
        schoolId: day.schoolId,
        schoolName: site.schoolName,
        date,
        contractMinutes: day.minutes,
        minutes,
        startTime: minutesToClock(slot.start),
        endTime: minutesToClock(slot.end),
        breakMinutes: slot.breakMinutes,
      });
    }
    if (suggestions.length > 0) result.set(date, suggestions);
  }
  return result;
}

/**
 * Der Satz zum Vorschlag: was der Vertrag sagt und warum weniger. Der Dialog
 * hängt die Bitte an, Beginn und Ende zu prüfen.
 */
export function suggestionSentence(
  suggestion: ContractSuggestion,
  { askToCheck = true }: { readonly askToCheck?: boolean } = {},
): string {
  const parts = [
    `Laut Arbeitsvertrag ${formatPlannedHours(suggestion.contractMinutes)} an ${suggestion.schoolName}.`,
  ];
  if (suggestion.minutes < suggestion.contractMinutes) {
    parts.push(
      `moto schlägt ${formatPlannedHours(suggestion.minutes)} vor, mehr ginge über das Soll der Woche oder die Höchstzeit am Tag.`,
    );
  }
  if (askToCheck) parts.push("Prüfe Beginn und Ende.");
  return parts.join(" ");
}
