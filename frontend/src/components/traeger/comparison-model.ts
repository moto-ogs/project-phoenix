/**
 * Reine Rechnung des Standortvergleichs (#4715): Namen und Schreibweise der
 * Kennzahlen, die Rangfolge einer Kennzahl und der Abstand einer Schule zum
 * Schnitt. Die Zahlen selbst rechnet das Backend (`traegerview.SchoolComparison`,
 * ADR 0242); eine Schule ohne Wert hat „–“, nie 0.
 */

import type {
  ComparedSchool,
  ComparisonMetric,
  ComparisonValues,
} from "~/lib/traeger-comparison-api";

/** `number` hat höchstens eine Nachkommastelle, `change` ein Vorzeichen. */
type MetricFormat = "number" | "share" | "change";

export interface ComparisonMetricInfo {
  readonly key: ComparisonMetric;
  /** Spaltenkopf und Name in der Auswahl. */
  readonly label: string;
  /** Was die Zahl zählt, in einem Satz für die Auswahl. */
  readonly hint: string;
  readonly format: MetricFormat;
}

/** Jede Kennzahl in der Reihenfolge des Backends. */
export const COMPARISON_METRIC_INFO: readonly ComparisonMetricInfo[] = [
  {
    key: "places",
    label: "Plätze",
    hint: "Summe der Platzgrenzen aller Betreuungsformen",
    format: "number",
  },
  {
    key: "places_rate",
    label: "Plätze belegt",
    hint: "Anteil der Plätze, die im Schnitt gebucht waren",
    format: "share",
  },
  {
    key: "free_places",
    label: "Freie Plätze",
    hint: "Plätze ohne Buchung, im Schnitt je Tag",
    format: "number",
  },
  {
    key: "booked",
    label: "Kinder gebucht",
    hint: "Gebuchte Kinder, im Schnitt je Tag",
    format: "number",
  },
  {
    key: "booked_change",
    label: "Veränderung gebucht",
    hint: "Gebuchte Kinder am letzten Tag minus am ersten Tag",
    format: "change",
  },
  {
    key: "present",
    label: "Kinder anwesend",
    hint: "Kinder mit Check-in, im Schnitt je Tag mit Check-ins",
    format: "number",
  },
  {
    key: "present_peak",
    label: "Höchstens anwesend",
    hint: "Die meisten Kinder mit Check-in an einem Tag",
    format: "number",
  },
  {
    key: "active_students",
    label: "Aktive Kinder am Stichtag",
    hint: "Kinder am letzten Stichtag im Zeitraum, wie in den Stichtagszahlen",
    format: "number",
  },
];

const INFO = new Map(COMPARISON_METRIC_INFO.map((info) => [info.key, info]));

export function metricInfo(key: ComparisonMetric): ComparisonMetricInfo {
  const info = INFO.get(key);
  if (!info) throw new Error(`unknown comparison metric ${key}`);
  return info;
}

/** Die Spalten beim ersten Öffnen: Plätze, Kinder und Stichtag. */
export const DEFAULT_METRICS: readonly ComparisonMetric[] = [
  "places_rate",
  "free_places",
  "booked",
  "present",
  "active_students",
];

/** Die Kennzahl der Rangfolge beim ersten Öffnen. */
export const DEFAULT_RANKING_METRIC: ComparisonMetric = "places_rate";

const WHOLE = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const DECIMAL = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const SIGNED = new Intl.NumberFormat("de-DE", {
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});

/** „84 %“, „18,5“, „+3“, „120“; „–“ ohne Wert. */
export function formatMetric(
  key: ComparisonMetric,
  value: number | undefined,
): string {
  if (value === undefined) return "–";
  switch (metricInfo(key).format) {
    case "share":
      return `${WHOLE.format(value * 100)} %`;
    case "change":
      return SIGNED.format(value);
    case "number":
      return DECIMAL.format(value);
  }
}

/**
 * Der Abstand zum Schnitt der Schulen in Worten: „12 Punkte über Schnitt“,
 * „2,5 unter Schnitt“, „wie Schnitt“. „Ø“ heißt auf der Seite dagegen
 * „je Tag“. `null`, wenn eine der Zahlen fehlt oder es nur eine Schule gibt.
 */
export function deviationLabel(
  key: ComparisonMetric,
  value: number | undefined,
  average: number | undefined,
  schools: number,
): string | null {
  if (value === undefined || average === undefined || schools < 2) {
    return null;
  }
  const share = metricInfo(key).format === "share";
  const delta = share ? (value - average) * 100 : value - average;
  const rounded = Math.round(delta * 10) / 10;
  const size = share ? Math.round(Math.abs(delta)) : Math.abs(rounded);
  if (size === 0) return "wie Schnitt";
  const amount = share
    ? `${WHOLE.format(size)} ${size === 1 ? "Punkt" : "Punkte"}`
    : DECIMAL.format(size);
  return `${amount} ${delta > 0 ? "über" : "unter"} Schnitt`;
}

export interface RankingEntry {
  readonly school: ComparedSchool;
  readonly value: number;
}

/** Die Schulen mit Wert, größter zuerst; bei gleichem Wert nach Namen. */
export function ranking(
  schools: readonly ComparedSchool[],
  key: ComparisonMetric,
): RankingEntry[] {
  return schools
    .flatMap((school) => {
      const value = school.values[key];
      return value === undefined ? [] : [{ school, value }];
    })
    .sort(
      (a, b) =>
        b.value - a.value || a.school.name.localeCompare(b.school.name, "de"),
    );
}

export interface Spread {
  readonly highest: RankingEntry;
  readonly lowest: RankingEntry;
}

/** Die höchste und die niedrigste Schule; `null` unter zwei Werten. */
export function spread(
  schools: readonly ComparedSchool[],
  key: ComparisonMetric,
): Spread | null {
  const ranked = ranking(schools, key);
  const highest = ranked[0];
  const lowest = ranked.at(-1);
  if (!highest || !lowest || ranked.length < 2) return null;
  return { highest, lowest };
}

/** Eine Zeile der Tabelle: eine Schule oder eine der zwei Summenzeilen. */
export type ComparisonRow =
  | { readonly kind: "school"; readonly school: ComparedSchool }
  | {
      readonly kind: "average" | "together";
      readonly label: string;
      readonly values: ComparisonValues;
    };

/** Die Schulen, darunter der Schnitt und die Summe, ab zwei Schulen. */
export function comparisonRows(
  schools: readonly ComparedSchool[],
  average: ComparisonValues,
  together: ComparisonValues,
): ComparisonRow[] {
  const rows: ComparisonRow[] = schools.map((school) => ({
    kind: "school",
    school,
  }));
  if (schools.length < 2) return rows;
  return [
    ...rows,
    { kind: "average", label: "Schnitt je Schule", values: average },
    { kind: "together", label: "Alle zusammen", values: together },
  ];
}

export function rowValues(row: ComparisonRow): ComparisonValues {
  return row.kind === "school" ? row.school.values : row.values;
}
