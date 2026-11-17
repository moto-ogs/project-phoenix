/**
 * The shape of the `user.id` a Sentry event may carry (#3843): 128 bits of an
 * HMAC as hex, never a raw account ID. The session callback derives it with
 * the server secret (server/auth/sentry-pseudonym.ts); the backend's has the
 * same shape (backend/api/sentry_session.go). Free of Sentry imports, so the
 * type-only sentry.shared.ts can check it too.
 */
const SENTRY_USER_PSEUDONYM = /^[0-9a-f]{32}$/;

/** Whether a value has the shape of a Sentry user pseudonym. */
export function isSentryUserPseudonym(value: unknown): value is string {
  return typeof value === "string" && SENTRY_USER_PSEUDONYM.test(value);
}
