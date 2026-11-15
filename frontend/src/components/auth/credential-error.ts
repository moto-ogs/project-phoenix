import { ApiError } from "~/lib/api-error";
import type { ErrorCode } from "~/lib/error-codes.generated";

/** The 401 refusals of a password login, in every portal. */
export const LOGIN_REFUSALS = [
  "identity.invalid_credentials",
  "identity.session_account_inactive",
] as const satisfies readonly ErrorCode[];

/**
 * The fields a refused password login marks when the answer names none
 * (#7111): e-mail and password, by their control `name`. A wrong password
 * must not tell which of the two was wrong, so both are marked; the form
 * then focuses the first of them instead of losing focus to the page.
 */
export const LOGIN_CREDENTIAL_FIELDS = {
  "identity.invalid_credentials": ["email", "password"],
  "care.invalid_credentials": ["email", "password"],
} as const satisfies Partial<Record<ErrorCode, readonly string[]>>;

/** The 401 refusals of a passkey login. */
export const PASSKEY_LOGIN_REFUSALS = [
  "identity.passkey_login_failed",
  "identity.session_account_inactive",
  "identity.mfa_code_invalid",
] as const satisfies readonly ErrorCode[];

/** The 401 refusal of an invitation accept: the invited account must log in. */
export const INVITATION_REFUSALS = [
  "identity.invitation_account_login_required",
] as const satisfies readonly ErrorCode[];

/**
 * The 401 refusals of an MFA step, in every portal: a wrong or expired code
 * (verify, resend, enrollment confirm), and the credential check of the
 * token exchange after a correct code, also under the parents portal's care
 * code. Any other 401 there is an expired challenge or enrollment session
 * and leads to the login screen.
 */
export const MFA_STEP_REFUSALS = [
  "identity.mfa_code_invalid",
  "identity.invalid_credentials",
  "care.invalid_credentials",
  "identity.session_account_inactive",
] as const satisfies readonly ErrorCode[];

/**
 * The shared error path sends every 401 to the login screen, because a 401
 * normally means the session ran out. A login step answers 401 for refused
 * credentials instead (wrong password, wrong code): there is no session to
 * renew, and a jump to the login page would hide the reason (#2517).
 *
 * Only a 401 whose code is in `codes` counts as such a refusal. It comes back
 * as a copy without the HTTP status, so the form shows the catalog text for
 * the code; code, details, field errors and request ID stay. Every other
 * error, including a 401 without one of these codes, is returned unchanged:
 * no code is invented here (ADR 0006).
 *
 * `fields` names, per code, the controls to mark when the refusal lists no
 * field errors of its own (`LOGIN_CREDENTIAL_FIELDS`).
 */
export function credentialError(
  error: unknown,
  codes: readonly ErrorCode[],
  fields: Partial<Record<ErrorCode, readonly string[]>> = {},
): unknown {
  if (!(error instanceof ApiError) || error.status !== 401) return error;
  if (!(error.code && codes.includes(error.code))) return error;
  const code = error.code;
  const errors =
    error.errors && error.errors.length > 0
      ? error.errors
      : fields[code]?.map((field) => ({
          field,
          reason: code.slice(code.indexOf(".") + 1),
        }));
  const copy = new ApiError(error.message, undefined, {
    code,
    details: error.details,
    errors,
    instance: error.instance,
  });
  copy.requestId = error.requestId;
  copy.retryAfterSeconds = error.retryAfterSeconds;
  return copy;
}
