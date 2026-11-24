// Der Stand einer freiwilligen Einwilligung aus der Ferienanmeldung (#8038,
// ADR 0321), gleich für Elternportal und ausrichtende OGS.

/** Given, withdrawn, or never given. */
export type HolidayConsentState = "given" | "withdrawn" | "notGiven";

/**
 * The state of a consent: given while it holds, withdrawn when it once held
 * and no longer does (it then names when), never given otherwise.
 */
export function holidayConsentState(consent: {
  readonly given: boolean;
  readonly changedAt: string | null;
}): HolidayConsentState {
  if (consent.given) return "given";
  return consent.changedAt ? "withdrawn" : "notGiven";
}
