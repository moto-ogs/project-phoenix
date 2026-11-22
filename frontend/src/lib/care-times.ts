import { bffFile, bffJson } from "./bff-fetch";
import { knownEnum, requiredEnum } from "./contract/known-enum";
import type * as statisticsContract from "./contract/statistics.generated";

// Soll und Ist je Kind (#4774): client for the per-child comparison and the
// overrun list of the school management. The definitions live in the
// backend (studentpresence.CareTimeToleranceMinutes) and are repeated here
// only as screen text.

const CARE_TIME_DAY_KINDS = [
  "within_plan",
  "overrun",
  "unbooked",
  "absent",
  "sick",
  "excused",
  "cancelled",
  "closed",
  "open",
  "no_plan",
  "end_unknown",
] as const;

export type CareTimeDayKind = (typeof CARE_TIME_DAY_KINDS)[number];

/**
 * Woher das Soll kommt: bestätigte Ferienbuchung (#5994), Vertrag des
 * Trägers (#4683) oder Betreuungsplan.
 */
const PLANNED_SOURCES = ["holiday_booking", "contract", "care_plan"] as const;

export type CareTimePlannedSource = (typeof PLANNED_SOURCES)[number];

/**
 * Ein Tag mit Soll und Ist. `class_times` (#5656) sind Zeiten im Unterricht,
 * nur als Hinweis; sie ändern keine Minuten.
 */
export type CareTimeDay = Omit<
  statisticsContract.careTimeDayResponse,
  "kind" | "planned_source" | "class_times"
> & {
  kind: CareTimeDayKind;
  planned_source?: CareTimePlannedSource;
  class_times?: statisticsContract.careTimeClassTimeResponse[];
};

export type StudentCareTimes = Omit<
  statisticsContract.studentCareTimesResponse,
  "days"
> & { days: CareTimeDay[] };

export type CareTimeOverruns = Omit<
  statisticsContract.careTimeOverrunsResponse,
  "students"
> & { students: statisticsContract.careTimeOverrunRowResponse[] };

export type CareTimeExportFormat = "pdf" | "xlsx";

/** Tone of the day's status pill; matches the kit's StatusBadge tones. */
export type CareTimeTone = "blue" | "green" | "warning" | "red" | "gray";

/** Gruppen- und Klassenfilter der Statistik, beide wiederholbar. */
export interface CareTimeFilter {
  groupIds?: readonly string[];
  schoolClasses?: readonly string[];
}

function windowQuery(
  fromISO: string,
  toISO: string,
  filter: CareTimeFilter = {},
) {
  return {
    from: fromISO,
    to: toISO,
    group_id: filter.groupIds ?? [],
    school_class: filter.schoolClasses ?? [],
  };
}

function careTimeDay(day: statisticsContract.careTimeDayResponse): CareTimeDay {
  const { planned_source, ...rest } = day;
  const source = knownEnum(PLANNED_SOURCES, planned_source);
  return {
    ...rest,
    // The day's pill has no text for a kind this build does not know.
    kind: requiredEnum(CARE_TIME_DAY_KINDS, day.kind, "care time day kind"),
    ...(source && { planned_source: source }),
    class_times: day.class_times ?? [],
  };
}

export async function fetchStudentCareTimes(
  studentId: string,
  fromISO: string,
  toISO: string,
): Promise<StudentCareTimes> {
  const result = await bffJson(
    "tenant",
    "GET /api/statistics/students/{id}/care-times",
    {
      params: { id: studentId },
      query: windowQuery(fromISO, toISO),
      errorMessage: "student care times request failed",
    },
  );
  return { ...result, days: (result.days ?? []).map(careTimeDay) };
}

export async function fetchCareTimeOverruns(
  fromISO: string,
  toISO: string,
  filter: CareTimeFilter = {},
): Promise<CareTimeOverruns> {
  const result = await bffJson(
    "tenant",
    "GET /api/statistics/care-time-overruns",
    {
      query: windowQuery(fromISO, toISO, filter),
      errorMessage: "care time overruns request failed",
    },
  );
  return { ...result, students: result.students ?? [] };
}

/** The overrun list as a file; the caller reads body and file name. */
export function fetchCareTimeOverrunsExport(
  fromISO: string,
  toISO: string,
  format: CareTimeExportFormat,
  filter: CareTimeFilter = {},
): Promise<Response> {
  return bffFile("tenant", "GET /api/statistics/care-time-overruns/export", {
    query: { ...windowQuery(fromISO, toISO, filter), format },
    errorMessage: "care time export failed",
  });
}

/** Text und Farbe je Tag; die Markierung trägt immer den Text, nie nur Farbe. */
export const CARE_TIME_DAY_LABELS: Record<
  CareTimeDayKind,
  { label: string; tone: CareTimeTone }
> = {
  within_plan: { label: "Wie gebucht", tone: "green" },
  overrun: { label: "Außerhalb der Buchung", tone: "warning" },
  unbooked: { label: "Da ohne Buchung", tone: "warning" },
  absent: { label: "Nicht da", tone: "gray" },
  sick: { label: "Krank", tone: "red" },
  excused: { label: "Entschuldigt", tone: "gray" },
  cancelled: { label: "Abgemeldet", tone: "gray" },
  closed: { label: "Geschlossen", tone: "gray" },
  open: { label: "Noch nicht abgemeldet", tone: "blue" },
  no_plan: { label: "Keine Zeiten hinterlegt", tone: "gray" },
  end_unknown: { label: "Abholzeit fehlt", tone: "gray" },
};

/** „08:00–15:00“, „ab 08:00“ oder „–“, wenn beide Zeiten fehlen. */
export function formatClockSpan(
  start: string | null,
  end: string | null,
): string {
  if (start && end) return `${start}–${end}`;
  if (start) return `ab ${start}`;
  if (end) return `bis ${end}`;
  return "–";
}

/** Minuten mit Vorzeichen: „+20 Min.“, „-420 Min.“, „0 Min.“ */
export function formatDeviation(minutes: number | null): string {
  if (minutes === null) return "–";
  if (minutes > 0) return `+${minutes} Min.`;
  return `${minutes} Min.`;
}

/** „Zum Unterricht: 08:30–13:00“; ohne Rückkehr „Zum Unterricht: ab 08:30“. */
export function classTimesHint(day: CareTimeDay): string | null {
  if (!day.class_times?.length) return null;
  const spans = day.class_times.map(({ start, end }) =>
    formatClockSpan(start, end),
  );
  return `Zum Unterricht: ${spans.join(", ")}`;
}

/** Warum ein Tag als Überschreitung zählt, in Worten. */
export function overrunReason(day: CareTimeDay): string | null {
  if (day.kind === "unbooked")
    return "An diesem Tag ist keine Betreuung gebucht.";
  if (day.kind !== "overrun") return null;
  const parts: string[] = [];
  if (day.early_minutes > 0)
    parts.push(`${day.early_minutes} Min. früher gekommen`);
  if (day.late_minutes > 0)
    parts.push(`${day.late_minutes} Min. später gegangen`);
  return parts.join(", ");
}
