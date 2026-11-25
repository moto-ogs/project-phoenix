import { berlinTodayISO, parseISODate, toISODate } from "~/lib/date-helpers";

export interface StatusDayRange {
  readonly from: string;
  readonly to: string;
}

export function getStatusDayRange(): StatusDayRange {
  const today = berlinTodayISO();
  const from = parseISODate(today);
  from.setDate(from.getDate() - 14);
  const to = parseISODate(today);
  to.setDate(to.getDate() + 90);
  return { from: toISODate(from), to: toISODate(to) };
}
