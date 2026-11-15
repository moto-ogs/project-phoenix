/**
 * Pure helpers of the daily attendance report (#4717): labels, sums and the
 * period limit. The page and its tests share them.
 */

import { formatDuration, parseISODate, toISODate } from "~/lib/date-helpers";
import {
  DAILY_ATTENDANCE_MAX_DAYS,
  type DailyAttendanceFigures,
  type DailyAttendancePeriod,
} from "~/lib/traeger-daily-attendance-api";

const WEEKDAY_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"] as const;

/** „Mo, 09.11.“ for a `YYYY-MM-DD` day. */
export function dayLabel(date: string): string {
  const day = parseISODate(date);
  const dd = String(day.getDate()).padStart(2, "0");
  const mm = String(day.getMonth() + 1).padStart(2, "0");
  return `${WEEKDAY_SHORT[day.getDay()]}, ${dd}.${mm}.`;
}

/** True on Saturday and Sunday. */
export function isWeekend(date: string): boolean {
  const weekday = parseISODate(date).getDay();
  return weekday === 0 || weekday === 6;
}

/** „5 Std. 20 Min.“, „45 Min.“; „–“ without a value. */
export function durationLabel(minutes: number | null): string {
  return minutes === null ? "–" : formatDuration(minutes);
}

/** The children reported absent: sick, excused and on a class trip. */
export function absentTotal(figures: DailyAttendanceFigures): number {
  return figures.sick + figures.excused + figures.classTrip;
}

/** „12 krank · 3 entschuldigt · 1 Klassenfahrt“, only the parts above 0. */
export function absentBreakdown(figures: DailyAttendanceFigures): string {
  const parts = [
    figures.sick > 0 ? `${figures.sick} krank` : null,
    figures.excused > 0 ? `${figures.excused} entschuldigt` : null,
    figures.classTrip > 0 ? `${figures.classTrip} Klassenfahrt` : null,
  ].filter((part): part is string => part !== null);
  return parts.join(" · ");
}

/** A day with no child present and none reported absent. */
export function isEmptyDay(figures: DailyAttendanceFigures): boolean {
  return figures.present === 0 && absentTotal(figures) === 0;
}

/** „12,5“: one decimal only where it is not whole. */
export function decimalLabel(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(1).replace(".", ",");
}

/**
 * Keeps a period within DAILY_ATTENDANCE_MAX_DAYS: a longer one keeps its
 * end and starts that many days before. `clamped` tells the page to say so.
 */
export function limitPeriod(period: DailyAttendancePeriod): {
  readonly period: DailyAttendancePeriod;
  readonly clamped: boolean;
} {
  const from = parseISODate(period.from);
  const to = parseISODate(period.to);
  const earliest = new Date(
    to.getFullYear(),
    to.getMonth(),
    to.getDate() - (DAILY_ATTENDANCE_MAX_DAYS - 1),
  );
  if (from >= earliest) return { period, clamped: false };
  return {
    period: { from: toISODate(earliest), to: period.to },
    clamped: true,
  };
}
