/**
 * The key date a key day produces, as the backend computes it (#2791,
 * #7301): moto counts on the key date from 6 a.m.; a day that is already
 * reached this month counts again next month. `today` is the Berlin school
 * day (YYYY-MM-DD). Operators work after 6 a.m., so the day itself counts as
 * reached; the saved answer of the backend is exact.
 */
export function nextBillingKeyDate(keyDay: number, today: string): string {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const day = Number(today.slice(8, 10));
  const nextMonth = keyDay <= day;
  const targetYear = nextMonth && month === 12 ? year + 1 : year;
  const targetMonth = nextMonth ? (month % 12) + 1 : month;
  return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(keyDay).padStart(2, "0")}`;
}

/**
 * True when a new key day is already reached this month: a school still
 * without figures this month then gets none for it, because moto never
 * counts a key date that passed before the change.
 */
export function keyDayPassedThisMonth(keyDay: number, today: string): boolean {
  return keyDay <= Number(today.slice(8, 10));
}

/** "November 2026" for a day (YYYY-MM-DD). */
export function billingMonthName(day: string): string {
  const months = [
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
  ];
  return `${months[Number(day.slice(5, 7)) - 1] ?? ""} ${day.slice(0, 4)}`;
}
