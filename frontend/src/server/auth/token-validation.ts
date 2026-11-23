import "server-only";
import { contractWrite } from "~/lib/contract/client.server";
import {
  routes,
  type SessionClaimsResponse,
} from "~/lib/contract/auth-session.generated";
import type { ErrorCode } from "~/lib/error-codes.generated";
import { decodeJwtPayload, type JwtPayload } from "./jwt-payload";
import { acceptsScope, type ValidationPortal } from "./portals";

/**
 * The backend answers the claims' identifiers as strings (ADR 0300, #7808);
 * the session keeps the access token's own claim shape, whose school,
 * Träger and preview admin are numbers.
 */
function claimShape(
  answer: SessionClaimsResponse & { id: string },
): JwtPayload {
  return {
    ...answer,
    tenant_id:
      answer.tenant_id === undefined ? undefined : Number(answer.tenant_id),
    org_id: answer.org_id === undefined ? undefined : Number(answer.org_id),
    acting_admin_id:
      answer.acting_admin_id === undefined
        ? undefined
        : Number(answer.acting_admin_id),
  };
}

/** Only backend-verified claims may cross a client token-handoff boundary. */
export async function validateSessionToken(
  accessToken: string,
  portal: ValidationPortal,
  refreshToken?: string,
): Promise<JwtPayload | null> {
  if (
    typeof accessToken !== "string" ||
    !accessToken ||
    accessToken.length > 16000 ||
    (refreshToken !== undefined &&
      (typeof refreshToken !== "string" ||
        !refreshToken ||
        refreshToken.length > 16000))
  )
    return null;
  try {
    const reply = await contractWrite(
      routes["POST /auth/session/validate"],
      { access_token: accessToken, refresh_token: refreshToken, portal },
      { token: accessToken, timeout: "session" },
    );
    if (!reply.ok) return null;
    const claims = reply.value;
    if (
      !claims.id ||
      typeof claims.exp !== "number" ||
      claims.exp * 1000 <= Date.now()
    )
      return null;
    if (!acceptsScope(portal, claims.scope)) return null;
    return claimShape({ ...claims, id: claims.id });
  } catch {
    return null;
  }
}

/**
 * live: the family backs the token; notBooked: it does, but the school has
 * not booked the portal's module; ended: revoked; unknown: no answer, or an
 * expired token.
 */
export type SessionFamilyState = "live" | "notBooked" | "ended" | "unknown";

const moduleNotBookedCode: ErrorCode = "module.not_booked";

/** A module the school did not book closes pages, not the session. */
export function familyBacksSession(state: SessionFamilyState): boolean {
  return state === "live" || state === "notBooked";
}

/**
 * Asks Identity & Access whether the refresh-token family an access token
 * names still backs it (#5399). Without the refresh token the backend reads
 * the family itself; with it, a rotated token of a live family would fail.
 * The BFF writes or shows a session only for a live family, so the answer of
 * a request that outlived its logout sets no cookie and reads as ended.
 */
export async function sessionFamilyState(
  accessToken: string,
  portal: ValidationPortal,
): Promise<SessionFamilyState> {
  if (!accessToken || accessToken.length > 16000) return "ended";
  // Identity & Access rejects an expired token before it reads the family,
  // so its refusal says nothing about the family. The session's refresh
  // decides; a revoked family ends there.
  const expiry = decodeJwtPayload(accessToken)?.exp;
  if (typeof expiry === "number" && expiry * 1000 <= Date.now()) {
    return "unknown";
  }
  try {
    const reply = await contractWrite(
      routes["POST /auth/session/validate"],
      { access_token: accessToken, portal },
      { token: accessToken, timeout: "session" },
    );
    if (reply.ok) return "live";
    if (reply.error.status === 401) return "ended";
    if (reply.error.status === 403 && reply.error.code === moduleNotBookedCode)
      return "notBooked";
    return "unknown";
  } catch {
    return "unknown";
  }
}
