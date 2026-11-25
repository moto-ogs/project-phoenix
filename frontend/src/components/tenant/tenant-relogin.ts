import { ApiError } from "~/lib/api-error";
import { bffJson } from "~/lib/bff-fetch";
import { sessionBff } from "~/lib/session-bff";
import { clearSessionCache, DELIBERATE_LOGOUT_KEY } from "~/lib/session-cache";
import { clearPersonalStorage } from "~/lib/personal-storage";
import { mutate } from "~/lib/swr";
import { clientEnv } from "~/env.client";
import { unsubscribePushSilently } from "~/lib/push-api";
import { createLogger } from "~/lib/logger";
import { runTenantSessionEnd } from "~/lib/tenant-session-end";
import { discardSessionTree } from "~/lib/session-tree";
import {
  leaveReplacedSession,
  signOutTenant,
  tenantSessionReplaced,
} from "~/lib/tenant-session-cookie";
import {
  END_SESSION_HEADER,
  endSessionHeader,
  shownSessionMark,
} from "~/lib/session-mark";

const logger = createLogger({ component: "TenantRelogin" });

/**
 * Same logout endpoints/order as the tenant shell, without its source-host
 * redirect. `mark` names the session it ends: by default the tree's, or the
 * one the cookie holds after a step of this tab (a staff preview ended
 * inside a school switch).
 */
export function reloginAtTenant(
  subdomain: string,
  mark: string = shownSessionMark(),
): Promise<void> {
  const port = window.location.port ? `:${window.location.port}` : "";
  const callbackUrl = `${window.location.protocol}//${subdomain}.${clientEnv.NEXT_PUBLIC_TENANT_DOMAIN}${port}/`;
  return runTenantSessionEnd(
    (signal) => endSessionAndNavigate(callbackUrl, mark, signal),
    callbackUrl,
  );
}

async function endSessionAndNavigate(
  callbackUrl: string,
  mark: string,
  signal: AbortSignal,
): Promise<void> {
  // Revoke the refresh family BEFORE Auth.js deletes the shared domain cookie.
  // The response-aware BFF can refresh/reissue that cookie while logging out.
  // The revocation never waits for push (#5194); the backend drops the
  // family's push subscriptions with it.
  // A session step of the BFF: through `public`, so a 401 neither renews the
  // session nor opens the login.
  try {
    await bffJson("public", sessionBff.logout("tenant"), {
      // Another school's sign-in since is not this exit's: the route revokes
      // nothing of it and answers 401 (#8082).
      headers: { [END_SESSION_HEADER]: endSessionHeader("tenant", mark) },
      signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
      errorMessage: "Tenant logout failed",
    });
  } catch (error) {
    signal.throwIfAborted();
    // 401 means there is no live authenticated family left to revoke, e.g.
    // retrying after cookie deletion failed. Still remove its Auth.js cookie.
    if (!isNothingToRevoke(error)) throw error;
  }
  signal.throwIfAborted();
  // The family is gone: nothing of the session shows from now (#8082).
  discardSessionTree();
  // Cleanup must not hold navigation on a revoked session: other protected
  // requests can already redirect it to the source school's login (#5260).
  void unsubscribePushSilently("tenant", { signal, timeoutMs: 5000 });
  try {
    await mutate(() => true, undefined, { revalidate: false });
  } catch (error) {
    // Cache cleanup must never prevent deletion of a revoked session cookie.
    logger.warn("relogin_cache_clear_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  signal.throwIfAborted();
  // Before this device's data of the account goes: another school's sign-in
  // meanwhile owns it now (#8082).
  if (tenantSessionReplaced(mark)) {
    leaveReplacedSession();
    return;
  }
  // Nothing personal of the source school's account stays on the device (#5000).
  clearPersonalStorage();
  clearSessionCache();
  try {
    sessionStorage.setItem(DELIBERATE_LOGOUT_KEY, "1");
  } catch {
    // Storage is optional; the server-side revocation and cookie deletion are not.
  }
  await signOutTenant({ callbackUrl, revoked: true, mark }, signal);
}

/** A 401 answer of the logout: no live session family is left to revoke. */
function isNothingToRevoke(error: unknown): boolean {
  return error instanceof ApiError && !error.noResponse && error.status === 401;
}
