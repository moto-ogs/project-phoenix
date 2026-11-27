import { berlinTodayISO, isValidISODate } from "~/lib/date-helpers";

/** Rejects impossible dates, then uses the school's Berlin day. */
export function slotListDate(rawDate: string | null | undefined): string {
  return rawDate && isValidISODate(rawDate) ? rawDate : berlinTodayISO();
}
