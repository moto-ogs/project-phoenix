// Länger als gebucht (#4683, ADR 0156): wie oft Kinder an den Schulen des
// Trägers länger da waren, als ihr Vertrag bucht. Ohne Namen braucht die
// Auswertung das Recht „Berichte lesen“, mit Namen „Verträge verwalten“.

import { requiredDay } from "./contract/required-day";
import type * as traegerCareTimeOverrunsContract from "./contract/traeger-care-time-overruns.generated";
import { traegerRequest } from "./traeger-api";

const OVERRUNS_PATH = "/api/traeger/care-time-overruns";

/** Das Recht, das die Kinder mit Namen öffnet. */
export const OVERRUN_NAMES_RIGHT = "traeger_contracts:manage";

interface OverrunFigures {
  readonly children: number;
  readonly overrunDays: number;
  readonly unbookedDays: number;
  readonly extraMinutes: number;
}

export interface SchoolOverruns {
  readonly schoolId: string;
  readonly schoolName: string;
  /**
   * Erster verglichener Tag; die Löschfrist der Check-ins kann ihn kürzen.
   * null: die Schule hat keine Daten.
   */
  readonly dataFrom: string | null;
  /** Mit der Buchung verglichene Kind-Tage; 0 heißt: keine Aussage. */
  readonly comparedDays: number;
  /** Kind-Tage mit Check-in, die sich nicht vergleichen ließen (kein Plan, noch nicht ausgecheckt). */
  readonly uncomparedDays: number;
  readonly figures: OverrunFigures;
}

export interface OverrunChild {
  readonly schoolId: string;
  readonly schoolName: string;
  readonly studentId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly schoolClass: string;
  readonly overrunDays: number;
  readonly unbookedDays: number;
  readonly extraMinutes: number;
}

export interface OverrunEvaluation {
  readonly from: string;
  readonly to: string;
  readonly toleranceMinutes: number;
  readonly total: OverrunFigures;
  readonly schools: readonly SchoolOverruns[];
  readonly children: readonly OverrunChild[];
}

function figuresFromBackend(
  figures: traegerCareTimeOverrunsContract.OverrunFigures,
): OverrunFigures {
  return {
    children: figures.children,
    overrunDays: figures.overrun_days,
    unbookedDays: figures.unbooked_days,
    extraMinutes: figures.extra_minutes,
  };
}

function evaluationFromBackend(
  body: traegerCareTimeOverrunsContract.OverrunEvaluation,
): OverrunEvaluation {
  return {
    from: requiredDay(body.from, "overrun_evaluation.from"),
    to: requiredDay(body.to, "overrun_evaluation.to"),
    toleranceMinutes: body.tolerance_minutes,
    total: figuresFromBackend(body.total),
    schools: (body.schools ?? []).map((school) => ({
      schoolId: school.school_id,
      schoolName: school.school_name,
      dataFrom: school.data_from,
      comparedDays: school.compared_days,
      uncomparedDays: school.uncompared_days,
      figures: figuresFromBackend(school.figures),
    })),
    children: (body.children ?? []).map((child) => ({
      schoolId: child.school_id,
      schoolName: child.school_name,
      studentId: child.student_id,
      firstName: child.first_name,
      lastName: child.last_name,
      schoolClass: child.school_class,
      overrunDays: child.overrun_days,
      unbookedDays: child.unbooked_days,
      extraMinutes: child.extra_minutes,
    })),
  };
}

export interface OverrunWindow {
  readonly from: string;
  readonly to: string;
  readonly schoolId?: string;
}

function overrunQuery(window: OverrunWindow): string {
  const query = new URLSearchParams({ from: window.from, to: window.to });
  if (window.schoolId) query.set("school_id", window.schoolId);
  return query.toString();
}

/** Die Zahlen je Schule, ohne Namen. */
export async function fetchOverrunSummary(
  window: OverrunWindow,
): Promise<OverrunEvaluation> {
  return evaluationFromBackend(
    await traegerRequest<traegerCareTimeOverrunsContract.OverrunEvaluation>(
      `${OVERRUNS_PATH}?${overrunQuery(window)}`,
    ),
  );
}

/** Die Zahlen je Schule und die Kinder mit Namen; steht im Zugriffsprotokoll. */
export async function fetchOverrunChildren(
  window: OverrunWindow,
): Promise<OverrunEvaluation> {
  return evaluationFromBackend(
    await traegerRequest<traegerCareTimeOverrunsContract.OverrunEvaluation>(
      `${OVERRUNS_PATH}/children?${overrunQuery(window)}`,
    ),
  );
}

/** „2 Std. 15 Min.“, „45 Min.“, „0 Min.“ */
const HOURS = new Intl.NumberFormat("de-DE");

export function formatExtraTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  // „1.486 Std.“: große Stundenzahlen mit Tausenderpunkt. Zahl und Einheit
  // halten mit einem geschützten Leerzeichen zusammen.
  if (hours === 0) return `${rest}\u00A0Min.`;
  if (rest === 0) return `${HOURS.format(hours)}\u00A0Std.`;
  return `${HOURS.format(hours)}\u00A0Std. ${rest}\u00A0Min.`;
}

/** Tage mit längerer Betreuung, ob gebucht oder nicht. */
export function overrunDayCount(figures: {
  readonly overrunDays: number;
  readonly unbookedDays: number;
}): number {
  return figures.overrunDays + figures.unbookedDays;
}

/**
 * Wie weit die Auswahl verglichen ist. Eine Schule ohne verglichenen Tag
 * (keine Check-ins, nach ihrer Frist gelöscht, kein Plan) hat keine Daten: ihre Nullen
 * sagen nichts über Überschreitungen. Fehlende Daten erscheinen nie als
 * „keine Abweichung“ (#4683).
 */
export type OverrunCoverage = "complete" | "partial" | "none";

/**
 * Ob eine Schule Zahlen zeigt: ein verglichener Tag, oder eine schon
 * feststehende Überschreitung (frühe Ankunft an einem offenen Tag). Ohne
 * beides sind die Zahlen offen und keine Nullen.
 */
export function schoolHasFigures(school: SchoolOverruns, to: string): boolean {
  return (
    school.dataFrom !== null &&
    school.dataFrom <= to &&
    (school.comparedDays > 0 || overrunDayCount(school.figures) > 0)
  );
}

export function overrunCoverage(
  evaluation: OverrunEvaluation,
): OverrunCoverage {
  const { schools, from, to } = evaluation;
  if (schools.every((school) => !schoolHasFigures(school, to))) return "none";
  return schools.some(
    (school) =>
      school.comparedDays === 0 ||
      school.dataFrom === null ||
      school.dataFrom > from ||
      school.uncomparedDays > 0,
  )
    ? "partial"
    : "complete";
}
