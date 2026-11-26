/**
 * The auth generation of a session as a plain value (#8077): scope, school or
 * Träger, account, preview target, roles and permissions. The server builds
 * it for the snapshot a page seed was loaded with, the browser for its
 * current session (`authGeneration` in scope.ts); a seed counts only where
 * both agree. No SWR import, so server modules can use it.
 */

import type { Session } from "next-auth";
import { hasSessionAccess } from "~/lib/session-access";

/** Null while the session grants no access. */
export function sessionGeneration(
  session: Session | null | undefined,
): string | null {
  if (!hasSessionAccess(session)) return null;
  const user = session.user;
  return JSON.stringify([
    user.scope ?? "",
    user.tenantId ?? null,
    user.orgId ?? null,
    user.id,
    user.previewTargetAccountId ?? null,
    user.roles ?? [],
    user.permissions ?? [],
  ]);
}
