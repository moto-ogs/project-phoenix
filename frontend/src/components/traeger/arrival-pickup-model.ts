/**
 * What the page „Ankunft und Abholung“ (#4714) reads from a heatmap: the
 * busiest half hour, the children of an average day and the German labels of
 * weekdays and half hours. The averages themselves come from the backend.
 */

import type {
  ArrivalPickupHeatmap,
  ArrivalPickupWeekday,
} from "~/lib/traeger-arrival-pickup-api";

export type ArrivalPickupKind = "arrivals" | "pickups";

const WEEKDAYS = [
  "",
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
] as const;

const WEEKDAYS_SHORT = ["", "Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;

export function weekdayName(weekday: number): string {
  return WEEKDAYS[weekday] ?? "";
}

export function weekdayShort(weekday: number): string {
  return WEEKDAYS_SHORT[weekday] ?? "";
}

/** „07:30“ for 450 minutes after midnight. */
export function clockLabel(minute: number): string {
  const hours = Math.floor(minute / 60) % 24;
  return `${String(hours).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

/** „7:00“ over a full hour, nothing over a half hour. */
export function hourTick(minute: number): string {
  return minute % 60 === 0 ? `${Math.floor(minute / 60) % 24}:00` : "";
}

const AVERAGE = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

/** „23,4“; a small average keeps its decimal, so 0,4 does not read as 0. */
export function formatAverage(value: number): string {
  return AVERAGE.format(value);
}

/** „1 Kind“, „2,5 Kinder“. */
export function childrenLabel(value: number): string {
  return value === 1 ? "1 Kind" : `${formatAverage(value)} Kinder`;
}

export interface ArrivalPickupPeak {
  readonly weekday: number;
  readonly startMinute: number;
  readonly value: number;
}

/**
 * The half hour with the most children of one kind; the earlier weekday and
 * time win a tie. `null` when no child arrived or was picked up.
 */
export function peakOf(
  heatmap: ArrivalPickupHeatmap,
  kind: ArrivalPickupKind,
): ArrivalPickupPeak | null {
  let peak: ArrivalPickupPeak | null = null;
  for (const row of heatmap.weekdays) {
    for (const slot of row.slots) {
      const value = slot[kind];
      if (value > 0 && (peak === null || value > peak.value)) {
        peak = { weekday: row.weekday, startMinute: slot.startMinute, value };
      }
    }
  }
  return peak;
}

/** The children of one kind on an average day of a weekday. */
export function dayTotal(
  row: ArrivalPickupWeekday,
  kind: ArrivalPickupKind,
): number {
  return row.slots.reduce((sum, slot) => sum + slot[kind], 0);
}

/**
 * The children who arrive on an average day: the mean over the weekdays with
 * data, so a weekday without care does not pull it down.
 */
export function childrenPerDay(heatmap: ArrivalPickupHeatmap): number | null {
  const counted = heatmap.weekdays.filter((row) => row.days > 0);
  if (counted.length === 0) return null;
  const sum = counted.reduce(
    (total, row) => total + dayTotal(row, "arrivals"),
    0,
  );
  return sum / counted.length;
}

/** Whether any weekday holds a counted day. */
export function hasData(heatmap: ArrivalPickupHeatmap): boolean {
  return heatmap.weekdays.some((row) => row.days > 0);
}

/** „Di 11:30“ for the head of a tile or a table cell. */
export function peakLabel(peak: ArrivalPickupPeak): string {
  return `${weekdayShort(peak.weekday)} ${clockLabel(peak.startMinute)}`;
}
