// The pattern of an invoice number (ADR 0119): text with the running number
// {N}…{NNNNNNNN}, padded with zeros to the count of N, and optionally the
// year as {JJJJ} or {JJ}. Mirrors formatInvoiceNumber of the backend, so a
// dialog can show a number before it is saved.

const NUMBER_TOKEN = /\{N{1,8}\}/g;
const YEAR_TOKEN = /\{JJJJ\}|\{JJ\}/g;

/** The largest running number a start value may name (#7358). */
export const MAX_NUMBER_RANGE_START = 99_999_999;

/** Whether the pattern names the year, so its counter starts again each year. */
export function patternHasYear(pattern: string): boolean {
  return pattern.search(YEAR_TOKEN) >= 0;
}

/** Writes the running number of the year into the pattern. */
export function formatInvoiceNumber(
  pattern: string,
  year: number,
  sequence: number,
): string {
  return pattern
    .replace(NUMBER_TOKEN, (token) =>
      String(sequence).padStart(token.length - 2, "0"),
    )
    .replace(YEAR_TOKEN, (token) =>
      token === "{JJ}"
        ? String(year % 100).padStart(2, "0")
        : String(year).padStart(4, "0"),
    );
}
