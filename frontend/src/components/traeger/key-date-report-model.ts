/**
 * Reine Hilfen der Berichte nach Vorlage (#4716): Stichtag, Zeilen je
 * Schule oder Sozialraum, Zahlenformate. Keine Daten, kein Netz.
 */

import { parseISODate, toISODate } from "~/lib/date-helpers";
import type {
  KeyDateReport,
  ReportCareForm,
  ReportFigures,
  ReportSection,
  ReportTemplate,
} from "~/lib/traeger-reports-api";

/** Der übliche Stichtag der Jugendhilfestatistik: der 15. Oktober. */
export const STANDARD_KEY_DATE = { month: 10, day: 15 } as const;

/** Name, kurze Erklärung und Reihenfolge jedes Abschnitts. */
export const SECTION_META: Record<
  ReportSection,
  { readonly label: string; readonly hint: string }
> = {
  children: {
    label: "Kinder pro Standort und Betreuungsform",
    hint: "Wie viele Kinder jede Schule am Stichtag hat, aufgeteilt nach Betreuungsform.",
  },
  staff: {
    label: "Personal",
    hint: "Wie viele Personen am Stichtag zum Personal jeder Schule gehören.",
  },
  absences: {
    label: "Fehlzeiten",
    hint: "Anwesende, kranke und entschuldigte Tage vom Schuljahresbeginn bis zum Stichtag, nur an Tagen mit Check-ins.",
  },
  demand: {
    label: "Belegung und Nachfrage",
    hint: "Plätze, belegte Plätze, offene Anmeldungen und Warteliste.",
  },
};

export const MONTH_NAMES = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
] as const;

/** Die Tage eines Monats; der Februar hat 29, damit der 29.02. wählbar bleibt. */
export function daysInMonth(month: number): number {
  return new Date(2000, month, 0).getDate();
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Der Tag `day.month.` im Jahr `year`; der 29.02. wird außerhalb von Schaltjahren zum 28.02. */
export function keyDateInYear(
  year: number,
  month: number,
  day: number,
): string {
  const last = new Date(year, month, 0).getDate();
  return `${year}-${pad(month)}-${pad(Math.min(day, last))}`;
}

/**
 * Der letzte Stichtag `day.month.` bis heute. Vor dem 15.10. eines Jahres ist
 * das der 15.10. des Vorjahres, ab dem 15.10. der des laufenden Jahres.
 */
export function latestKeyDate(
  today: string,
  month: number = STANDARD_KEY_DATE.month,
  day: number = STANDARD_KEY_DATE.day,
): string {
  const year = parseISODate(today).getFullYear();
  const thisYear = keyDateInYear(year, month, day);
  return thisYear <= today ? thisYear : keyDateInYear(year - 1, month, day);
}

/** `15.10.` für den Stichtag einer Vorlage. */
function formatDayMonth(month: number, day: number): string {
  return `${pad(day)}.${pad(month)}.`;
}

/** Ein Tag im Format des Kalenders verschoben um `days` Tage. */
export function shiftDate(date: string, days: number): string {
  const value = parseISODate(date);
  value.setDate(value.getDate() + days);
  return toISODate(value);
}

const NUMBER = new Intl.NumberFormat("de-DE");
const DECIMAL = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function formatCount(value: number): string {
  return NUMBER.format(value);
}

/** `12,5 %`; „–“ ohne Wert. */
export function formatPercent(value: number | null): string {
  return value === null ? "–" : `${DECIMAL.format(value)} %`;
}

/** `8,3`; „–“ ohne Wert. */
export function formatRatio(value: number | null): string {
  return value === null ? "–" : DECIMAL.format(value);
}

/** Der Anteil der belegten Plätze, 0 bis 1 oder darüber; `null` ohne Plätze. */
export function placeShare(figures: ReportFigures): number | null {
  return figures.places > 0 ? figures.bookedPlaces / figures.places : null;
}

/**
 * Was die Nachfrage über die Plätze hinaus will: positiv fehlen Plätze,
 * negativ bleiben welche frei; `null` ohne Plätze.
 */
export function demandGap(figures: ReportFigures): number | null {
  return figures.places > 0 ? figures.demand - figures.places : null;
}

export type ReportGrouping = "schools" | "districts";

/** Eine Zeile der Tabellen: eine Schule oder ein Sozialraum. */
export interface ReportRow {
  readonly key: string;
  readonly name: string;
  /** Ort der Schule oder Zahl der Schulen im Sozialraum. */
  readonly detail: string;
  /** Der Sozialraum einer Schule; `null` ohne Zuordnung oder bei Sozialräumen. */
  readonly district: string | null;
  readonly figures: ReportFigures;
  readonly careForms: readonly ReportCareForm[];
  /** Der erste Tag mit Check-ins, nur bei Schulen. */
  readonly attendanceFrom: string | null;
}

function schoolsLabel(count: number): string {
  return count === 1 ? "1 Schule" : `${formatCount(count)} Schulen`;
}

/** Die Zeilen einer Gliederung; ohne Sozialräume immer die Schulen. */
export function reportRows(
  report: KeyDateReport,
  grouping: ReportGrouping,
): ReportRow[] {
  if (grouping === "districts" && report.districts.length > 0) {
    return report.districts.map((group) => ({
      key: group.unmapped
        ? "district:unmapped"
        : `district:named:${group.name}`,
      name: group.name,
      detail: schoolsLabel(group.schools),
      district: null,
      figures: group.figures,
      careForms: group.careForms,
      attendanceFrom: null,
    }));
  }
  return report.schools.map((school) => ({
    key: `school:${school.id}`,
    name: school.name,
    detail: school.city,
    district: school.district,
    figures: school.figures,
    careForms: school.careForms,
    attendanceFrom: school.attendanceFrom,
  }));
}

/** Die Gesamtzeile unter jeder Tabelle. */
export function totalRow(report: KeyDateReport): ReportRow {
  return {
    key: "total",
    name: "Gesamt",
    detail: schoolsLabel(report.total.schools),
    district: null,
    figures: report.total.figures,
    careForms: report.total.careForms,
    attendanceFrom: null,
  };
}

/** Der späteste Beginn der Check-ins im Zeitraum der Fehlzeiten, für den Hinweis. */
export function lateAttendanceStart(report: KeyDateReport): {
  readonly schools: number;
  readonly first: string | null;
} {
  const window = report.absenceWindow;
  if (!window) return { schools: 0, first: null };
  const late = report.schools
    .map((school) => school.attendanceFrom)
    .filter((day): day is string => day !== null && day > window.from)
    .sort();
  return { schools: late.length, first: late[0] ?? null };
}

/** Kurzbeschreibung einer Vorlage für Listen: Stichtag, Abschnitte, Sozialräume. */
export function templateSummary(template: ReportTemplate): string {
  const districts = new Set(
    template.districts.map((entry) => entry.district.trim()).filter(Boolean),
  ).size;
  const parts = [
    `Stichtag ${formatDayMonth(template.keyDateMonth, template.keyDateDay)}`,
    template.sections.length === 1
      ? "1 Abschnitt"
      : `${template.sections.length} Abschnitte`,
  ];
  if (districts > 0) {
    parts.push(districts === 1 ? "1 Sozialraum" : `${districts} Sozialräume`);
  }
  return parts.join(" · ");
}

/** Die Namen der Sozialräume einer Vorlage, ohne Doppelte, nach Alphabet. */
export function districtNames(
  districts: readonly { readonly district: string }[],
): string[] {
  return [
    ...new Set(districts.map((entry) => entry.district.trim()).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, "de"));
}
