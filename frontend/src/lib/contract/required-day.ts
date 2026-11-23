// Kept apart from `runtime.ts`: client code maps answers with it, and
// importing the runtime would pull the decoders' zod into the page bundle.

/**
 * A calendar day the domain always sets. Go writes an empty `calendar.Date`
 * as null, so the contract types every day as nullable; for a day that is
 * never empty, null is a broken required field and fails like one
 * (ADR 0270 point 6) instead of reaching the page as an empty date.
 */
export function requiredDay(value: string | null, field: string): string {
  if (value === null) {
    throw new Error(`contract: required day ${field} is null`);
  }
  return value;
}
