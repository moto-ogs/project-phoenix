import "server-only";

import type { SessionClaimsResponse } from "~/lib/contract/auth-session.generated";

// Older access tokens can name an email; refresh tokens carry the stored key.
export type JwtPayload = Partial<SessionClaimsResponse> & {
  id: string;
  email?: string;
  token?: string;
};

export function sessionIdentifier(value: unknown): string | undefined {
  if (typeof value === "string" && /^(0|-?[1-9]\d{0,18})$/.test(value)) {
    return value;
  }
  // An older token or cookie may still carry exactly representable numbers.
  return typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : undefined;
}

/**
 * The claims of a JWT, read without verifying it: for logging, metrics and
 * expiry checks only. Null when the token is not three parts or its payload
 * is no JSON object.
 */
export function decodeJwtPayload(token: string): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(parts[1], "base64url").toString(),
      (key, value: unknown) => {
        // Cookies can still carry access tokens signed before IDs became text.
        if (!["id", "tenant_id", "org_id", "acting_admin_id"].includes(key)) {
          return value;
        }
        return sessionIdentifier(value);
      },
    );
    return typeof payload === "object" &&
      payload !== null &&
      !Array.isArray(payload)
      ? (payload as JwtPayload)
      : null;
  } catch {
    return null;
  }
}
