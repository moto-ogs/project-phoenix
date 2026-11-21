/**
 * Arbeitszeitregeln der Einsatzplanung (#4708, ADR 0242).
 *
 * moto prüft jede Schicht einer Person mit Personalakte über alle ihre
 * Einsatzorte: Tageshöchstzeit, Ruhezeit, Pausen und das Wochen-Soll. Ein
 * Verstoß lehnt das Speichern mit `workforce.shift_working_time_warning` ab.
 * Wer trotzdem plant, bestätigt die Hinweise und nennt, wo nötig, eine
 * Begründung. Beides steht danach im Änderungsprotokoll. Die Prüfung ist eine
 * Hilfe, kein Rechtsgutachten (Entscheidung E3).
 */
import { ApiError } from "~/lib/api-error";
import { parseISODate } from "~/lib/date-helpers";

const WORKING_TIME_WARNING_CODE = "workforce.shift_working_time_warning";

/** Die längste Begründung, die das Backend annimmt. */
export const WORKING_TIME_REASON_MAX = 500;

type WorkingTimeWarningKind =
  | "daily_maximum"
  | "rest_period"
  | "rest_shortened"
  | "break_too_short"
  | "above_soll";

/** Ein Verstoß: der Tag, der geplante Wert und die Regel, beide in Minuten. */
export interface WorkingTimeWarning {
  readonly kind: WorkingTimeWarningKind;
  /** Tag des Verstoßes; bei der Ruhezeit der Tag danach, beim Soll der Montag. */
  readonly date: string;
  readonly minutes: number;
  readonly limit: number;
  readonly needsReason: boolean;
}

/** Die Antwort der planenden Person auf die Hinweise. */
export interface WorkingTimeConfirmation {
  readonly confirmed: boolean;
  readonly reason: string;
}

/** Die Hinweise einer abgelehnten Schicht. */
export interface WorkingTimeRefusal {
  readonly warnings: readonly WorkingTimeWarning[];
  readonly reasonRequired: boolean;
}

/** A warning in the error details of `workforce.working_time_warning`; read defensively. */
interface RawWorkingTimeWarning {
  kind?: unknown;
  date?: unknown;
  minutes?: unknown;
  limit?: unknown;
  needs_reason?: unknown;
}

const KINDS: readonly WorkingTimeWarningKind[] = [
  "daily_maximum",
  "rest_period",
  "rest_shortened",
  "break_too_short",
  "above_soll",
];

function isKind(value: unknown): value is WorkingTimeWarningKind {
  return KINDS.includes(value as WorkingTimeWarningKind);
}

/** Liest einen Hinweis vom Backend; unbekannte Arten fallen weg. */
function mapWorkingTimeWarning(
  raw: RawWorkingTimeWarning,
): WorkingTimeWarning | null {
  if (!isKind(raw.kind) || typeof raw.date !== "string") return null;
  return {
    kind: raw.kind,
    date: raw.date.slice(0, 10),
    minutes: typeof raw.minutes === "number" ? raw.minutes : 0,
    limit: typeof raw.limit === "number" ? raw.limit : 0,
    needsReason: raw.needs_reason === true,
  };
}

export function mapWorkingTimeWarnings(raw: unknown): WorkingTimeWarning[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => mapWorkingTimeWarning(item as RawWorkingTimeWarning))
    .filter((item): item is WorkingTimeWarning => item !== null);
}

/** Die Hinweise eines Fehlers, wenn er eine Arbeitszeitregel meldet. */
export function workingTimeRefusalOf(err: unknown): WorkingTimeRefusal | null {
  if (!(err instanceof ApiError) || err.code !== WORKING_TIME_WARNING_CODE) {
    return null;
  }
  const warnings = mapWorkingTimeWarnings(err.details?.warnings);
  return {
    warnings,
    reasonRequired:
      err.details?.reason_required === true ||
      warnings.some((warning) => warning.needsReason),
  };
}

/** Die Felder, die eine bestätigte Planung an den Speicheraufruf hängt. */
export function workingTimeBody(confirmation?: WorkingTimeConfirmation | null) {
  if (!confirmation?.confirmed) return {};
  return {
    working_time_confirmed: true,
    working_time_reason: confirmation.reason.trim(),
  };
}

/** „9,5 Stunden“, „1 Stunde“, „45 Minuten“. */
export function formatWorkingHours(minutes: number): string {
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "Minute" : "Minuten"}`;
  const hours = Math.round((minutes / 60) * 100) / 100;
  const text = hours.toLocaleString("de-DE", { maximumFractionDigits: 2 });
  return `${text} ${hours === 1 ? "Stunde" : "Stunden"}`;
}

/** „Mi., 25.11.“ */
function formatWorkingDay(iso: string): string {
  return parseISODate(iso).toLocaleDateString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}

/** Ein Satz je Hinweis, in einfacher Sprache. */
export function describeWorkingTimeWarning(
  warning: WorkingTimeWarning,
): string {
  const day = formatWorkingDay(warning.date);
  const planned = formatWorkingHours(warning.minutes);
  const limit = formatWorkingHours(warning.limit);
  switch (warning.kind) {
    case "daily_maximum":
      return `${day}: ${planned} Arbeit geplant. Erlaubt sind ${limit} am Tag.`;
    case "break_too_short":
      return `${day}: ${planned} Pause geplant. Nötig sind ${limit}.`;
    case "rest_period":
      return `Vor ${day}: nur ${planned} Ruhezeit. Nötig sind ${limit}.`;
    case "rest_shortened":
      return `Vor ${day}: ${planned} Ruhezeit statt ${limit}. Plane dafür einen Ausgleich ein.`;
    case "above_soll":
      return `Woche ab ${day}: ${planned} geplant. Das Soll ist ${limit}.`;
  }
}
