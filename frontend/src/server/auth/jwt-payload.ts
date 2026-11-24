import "server-only";

import type { SessionClaimsResponse } from "~/lib/contract/auth-session.generated";
import { INT64_DECIMAL } from "~/lib/compare-ids";

// Older access tokens can name an email; refresh tokens carry the stored key.
export type JwtPayload = Partial<SessionClaimsResponse> & {
  id: string;
  email?: string;
  token?: string;
};

export function sessionIdentifier(value: unknown): string | undefined {
  if (typeof value === "string" && INT64_DECIMAL.test(value)) {
    return value;
  }
  // An older token or cookie may still carry exactly representable numbers.
  return typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : undefined;
}

/**
 * Decodes claims without verifying the JWT. Callers establish trust before
 * using them for a session. Returns null if the payload is not a JSON object
 * or the token does not have three parts.
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
