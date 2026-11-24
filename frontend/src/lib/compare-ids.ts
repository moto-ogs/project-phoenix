/** Decimal spelling shared by the wire decoder and session claim reader. */
export const INT64_DECIMAL = /^(0|-?[1-9]\d{0,18})$/;

/**
 * Exact order of two backend identifiers, which cross the wire as decimal
 * strings of int64 values (ADR 0300). `Number()` rounds anything past 2^53
 * and makes two distinct ids compare equal; a plain string compare orders
 * "9" above "10". A shorter digit string is smaller, equal lengths compare
 * digit by digit.
 */
export function compareIds(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

/** Whether a canonical decimal string is a positive signed 64-bit ID. */
export function isPositiveInt64Id(value: string): boolean {
  return (
    /^[1-9]\d*$/.test(value) && compareIds(value, "9223372036854775807") <= 0
  );
}
