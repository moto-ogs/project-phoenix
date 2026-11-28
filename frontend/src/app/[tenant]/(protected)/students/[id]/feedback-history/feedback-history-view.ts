import { formatDate, parseISODate } from "~/lib/date-helpers";
import type { FeedbackEntry } from "~/lib/feedback-api";

// Ansichtsmodell der Feedbackhistorie (#8270). Ein Eintrag trägt den
// Berliner Schultag ("YYYY-MM-DD") und die Wanduhrzeit ("HH:MM:SS") getrennt.
// Beides bleibt Text: kein `new Date(...)`, sonst rechnet der Browser in
// seiner eigenen Zeitzone um und ein Feedback von 23:30 Uhr rutscht auf den
// Folgetag.

const WEEKDAY_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"] as const;

export interface FeedbackDayGroup {
  /** Schultag als "YYYY-MM-DD": Schlüssel und Sortierwert der Gruppe. */
  readonly day: string;
  /** „Donnerstag, 26. November 2026“. */
  readonly label: string;
  /** Einträge des Tages, der späteste zuerst. */
  readonly entries: readonly FeedbackEntry[];
}

export interface FeedbackChartPoint {
  /** Achsenbeschriftung, der Wochentag: „Do“. */
  readonly day: string;
  /** Kopf des Tooltips: „Do 26.11.“. */
  readonly label: string;
  readonly positive: number;
  readonly neutral: number;
  readonly negative: number;
}

/** Einträge ab dem Schultag `startDay` (einschließlich). */
export function feedbackSince(
  entries: readonly FeedbackEntry[],
  startDay: string,
): FeedbackEntry[] {
  return entries.filter((entry) => entry.day >= startDay);
}

/** Uhrzeit ohne Sekunden, wie die Schule sie sieht: „23:30“. */
export function feedbackClock(time: string): string {
  return time.slice(0, 5);
}

/** Wochentag eines Schultags, unabhängig von der Gerätezeitzone. */
function weekdayShort(day: string): string {
  return WEEKDAY_SHORT[parseISODate(day).getDay()] ?? "";
}

/** „26.11.“ eines Schultags. */
function dayMonth(day: string): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}.`;
}

function latestFirst(a: FeedbackEntry, b: FeedbackEntry): number {
  return b.day.localeCompare(a.day) || b.time.localeCompare(a.time);
}

/** Tagesgruppen der Einzelliste, der jüngste Schultag zuerst. */
export function groupFeedbackByDay(
  entries: readonly FeedbackEntry[],
): FeedbackDayGroup[] {
  const byDay = new Map<string, FeedbackEntry[]>();
  for (const entry of [...entries].sort(latestFirst)) {
    const group = byDay.get(entry.day);
    if (group) group.push(entry);
    else byDay.set(entry.day, [entry]);
  }
  return Array.from(byDay, ([day, dayEntries]) => ({
    day,
    label: formatDate(day, true),
    entries: dayEntries,
  }));
}

/** Balken je Schultag für das Diagramm, der älteste Tag zuerst. */
export function feedbackChartData(
  entries: readonly FeedbackEntry[],
): FeedbackChartPoint[] {
  const counts = new Map<
    string,
    Record<FeedbackEntry["feedbackType"], number>
  >();
  for (const entry of entries) {
    const count = counts.get(entry.day) ?? {
      positive: 0,
      neutral: 0,
      negative: 0,
    };
    count[entry.feedbackType]++;
    counts.set(entry.day, count);
  }
  return Array.from(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, count]) => ({
      day: weekdayShort(day),
      label: `${weekdayShort(day)} ${dayMonth(day)}`,
      ...count,
    }));
}
