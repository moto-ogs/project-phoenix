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
