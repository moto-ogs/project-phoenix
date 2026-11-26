import { parseISODate } from "./date-helpers";
import {
  endOfWeek,
  resolveAccountStartDate,
  startOfWeek,
  toDateKey,
} from "./staff-metrics-helpers";

export const STAFF_PREVIEW_WEEKS = 4;

export function fourWeekStaffPreview(today: Date) {
  const firstMonday = startOfWeek(today);
  const lastDay = new Date(firstMonday);
  lastDay.setDate(lastDay.getDate() + STAFF_PREVIEW_WEEKS * 7 - 1);
  return { firstMonday, from: toDateKey(firstMonday), to: toDateKey(lastDay) };
}

export function staffWeek(day: string) {
  const date = parseISODate(day);
  const monday = startOfWeek(date);
  const previousDay = new Date(monday);
  previousDay.setDate(previousDay.getDate() - 1);
  return {
    from: toDateKey(monday),
    to: toDateKey(endOfWeek(date)),
    historyFrom: toDateKey(previousDay),
  };
}

export function staffAccountWindow(today: Date, accountStart?: string | null) {
  const anchor = resolveAccountStartDate(today, accountStart);
  const previousDay = new Date(anchor);
  previousDay.setDate(previousDay.getDate() - 1);
  return {
    anchor,
    from: toDateKey(anchor),
    historyFrom: toDateKey(previousDay),
    to: toDateKey(today),
    adjustmentTo: "9999-12-31",
  };
}
