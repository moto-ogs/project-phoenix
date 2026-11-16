/**
 * The way on after a school refused a switch for a missing second factor
 * (identity.mfa_session_required): sign out here and sign in at the target
 * school. The staff portal is German-only; the German error text and the help
 * article name this button, so all of them read the label from here (#7214).
 */
export const SCHOOL_SIGN_IN_LABEL = "Zur Schulanmeldung";

/** What the button does, for its tooltip. */
export function schoolSignInTooltip(schoolName: string): string {
  return `Meldet Sie ab und öffnet die Anmeldung von ${schoolName}.`;
}
