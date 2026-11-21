/** Display helpers of the holiday periods (#4659). */

import { formatDate } from "~/lib/date-helpers";
import { groupParallelWeeks } from "~/lib/holiday-week-groups";
import type { HolidayPeriod } from "~/lib/traeger-api";

/** "02.11.2026 bis 04.12.2026"; a day the backend left empty shows „–“. */
export function formatDateRange(
  from: string | null,
  to: string | null,
): string {
  return `${formatDay(from)} bis ${formatDay(to)}`;
}

/** The German date of a calendar day; „–“ when the backend sent none. */
export function formatDay(day: string | null): string {
  return day ? formatDate(day) : "–";
}

/**
 * "2 Wochen: 04.01.2027 bis 15.01.2027", or "Noch keine Woche". Weeks on the
 * same days count once and the schools are named: "1 Woche an 2 Schulen: ...".
 */
export function formatWeeks(period: HolidayPeriod): string {
  const weeks = period.weeks;
  if (weeks.length === 0) return "Noch keine Woche";
  const groups = groupParallelWeeks(weeks);
  const count = groups.length === 1 ? "1 Woche" : `${groups.length} Wochen`;
  const schools = new Set(weeks.map((week) => week.hostSchoolId)).size;
  const where = groups.length < weeks.length ? ` an ${schools} Schulen` : "";
  const firstDay = weeks.map((week) => week.startsOn).sort()[0] ?? "";
  const lastDay =
    weeks
      .map((week) => week.endsOn)
      .sort()
      .at(-1) ?? "";
  return `${count}${where}: ${formatDateRange(firstDay, lastDay)}`;
}

export function holidayStatusLabel(period: HolidayPeriod): string {
  return period.status === "published" ? "Veröffentlicht" : "Entwurf";
}
