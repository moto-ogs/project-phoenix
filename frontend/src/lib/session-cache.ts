// lib/session-cache.ts
// Caches getSession() results to avoid redundant calls when multiple
// service files fetch data in parallel (e.g. 5 parallel fetches = 1 session call).

/**
 * sessionStorage key used to distinguish a deliberate logout from a
 * session-expiry redirect.  Shared between the logout flow
 * (shell-auth-context) and the login page ([tenant]/page.tsx).
 */
export const DELIBERATE_LOGOUT_KEY = "deliberateLogout";

/**
 * sessionStorage marker: the last logout ended the session on this device,
 * but the server could not revoke it (#7209). The login page reads it once
 * and tells the person.
 */
export const LOGOUT_NOT_REVOKED_KEY = "logoutNotRevoked";

/**
 * sessionStorage marker: the logout running now follows the person's own
 * password change, which ended every session. The login page reads it once
 * and asks for the new password.
 */
export const PASSWORD_CHANGED_KEY = "passwordChanged";

import { getSession } from "next-auth/react";
import { handleAuthFailure } from "./auth-failure";
import {
  ApiError,
  onSessionTenantMismatch,
  unavailableApiError,
} from "./api-error";
import { clearRateLimitBackoff } from "./rate-limit-backoff";
import { hasSessionAccess } from "./session-access";
import { SESSION_PROVIDER_POLL_SECONDS } from "./session-provider-poll";
import { isTenantSessionEnding } from "./tenant-session-end";

let cached: {
  session: Awaited<ReturnType<typeof getSession>>;
  expiry: number;
} | null = null;
let inflight: Promise<Awaited<ReturnType<typeof getSession>>> | null = null;

// Track the tenant ID of the cached session.
// When the user switches tenants, the new session will have a different tenant_id,
// which automatically invalidates the stale cache entry.
let cachedTenantId: string | undefined;

// Parallel requests of one page are refused together; the provider needs to
// hear it once. Its next answer (primeSessionCache) re-arms the report.
let mismatchReported = false;

/** A confirmed SessionProvider answer re-arms mismatch reports in every portal. */
export function confirmSessionSnapshot() {
  mismatchReported = false;
}

const TTL_MS = 10_000; // 10 second cache window

/**
 * How long a session the provider reported stays: until shortly after its
 * next poll, which primes the cache again. Safe since the BFF refuses a
 * session of another school than the request's subdomain (#5130); the
 * refusal drops this entry (see the mismatch listener below).
 */
const PROVIDER_TTL_MS = (SESSION_PROVIDER_POLL_SECONDS + 30) * 1000;

/** Whether the session's own end (cookie lifetime) has passed. */
function sessionEnded(
  session: Awaited<ReturnType<typeof getSession>>,
  now: number,
): boolean {
  const expires = session?.expires;
  return typeof expires === "string" && Date.parse(expires) <= now;
}

async function getSessionOrUnavailable() {
  try {
    return await getCachedSession();
  } catch (error) {
    // The session endpoint is a network dependency just like the API route.
    // Preserve an already normalized error, but never let its raw transport
    // failure bypass the shared API error presentation.
    if (error instanceof ApiError) throw error;
    throw unavailableApiError(error);
  }
}

function authenticationRequiredError(): ApiError {
  return new ApiError("Authentication required", 401, {
    code: "general.permission",
  });
}

/**
 * Invalidate the cached session so the next call fetches a fresh one.
 * Call this after a successful token refresh or tenant switch so stale tokens aren't reused.
 */
export function clearSessionCache() {
  cached = null;
  cachedTenantId = undefined;
  inflight = null;
  clearRateLimitBackoff();
}

/**
 * Mirror of the tenant SessionProvider's answer (server session prop, poll,
 * update(), another tab's sign-in or logout). Every API client reads the
 * session via getCachedSession(); without the mirror the first fetcher of a
 * page load paid its own /api/auth/session round trip although the provider
 * was hydrated with the same session moments earlier (#2973).
 *
 * A session with access stays until shortly after the provider's next poll
 * (#5130). A school switch on another subdomain replaces the shared cookie
 * without telling this tab's provider (#5116 review); the BFF then refuses
 * the next request with `identity.session_tenant_mismatch`, which drops the
 * entry and wakes the provider. An answer without access (logout here or in
 * another tab, a failed or revoked refresh) drops a signed-in entry and any
 * lookup in flight: no later request passes as signed in. An answer without
 * access that the cache already holds stays; dropping it would send every
 * request to the session route again.
 */
export function primeSessionCache(
  session: Awaited<ReturnType<typeof getSession>>,
) {
  confirmSessionSnapshot();
  if (!hasSessionAccess(session)) {
    if (hasSessionAccess(cached?.session) || inflight) clearSessionCache();
    return;
  }
  cachedTenantId = session.user.tenantId;
  cached = { session, expiry: Date.now() + PROVIDER_TTL_MS };
  // A lookup still in flight predates this session; its result must not
  // overwrite the fresher seed (see the invariant in getCachedSession).
  inflight = null;
}

/**
 * What the SessionProvider shows of a session. `expires` moves with every
 * lookup and is left out; keys are sorted so the hydrated session and a
 * route answer compare equal.
 */
function sessionSnapshot(
  session: Awaited<ReturnType<typeof getSession>>,
): string {
  if (!session) return "null";
  const user = session.user as Record<string, unknown> | undefined;
  return JSON.stringify([
    user ? JSON.stringify(user, Object.keys(user).sort()) : null,
    session.error ?? null,
  ]);
}

/**
 * The message getSession() sends by default (next-auth 5.0.0-beta.32). This
 * tab's SessionProvider answers it with its own lookup; other tabs of the
 * origin do the same.
 */
export function announceSessionChange() {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel("next-auth");
  channel.postMessage({ event: "session", data: { trigger: "getSession" } });
  channel.close();
}

/**
 * The BFF refused a request: the cookie holds another school's session than
 * this subdomain (#5130). The cached session is that of this tab's school
 * and no longer the cookie's. Drop it and wake the provider, which reads
 * the cookie's session; TenantGuard then switches back to this school.
 */
function handleSessionTenantMismatch() {
  // A deliberate logout/relogin owns the cookie deletion and destination.
  // Waking SessionProvider here can reissue the old shared cookie after its
  // deletion response arrives.
  if (isTenantSessionEnding()) return;
  if (mismatchReported) return;
  mismatchReported = true;
  clearSessionCache();
  announceSessionChange();
}

onSessionTenantMismatch(handleSessionTenantMismatch);

export async function getCachedSession() {
  const now = Date.now();
  if (cached && now < cached.expiry && !sessionEnded(cached.session, now)) {
    // Verify the cached session still belongs to the same tenant.
    // After a tenant switch, the session's tenant_id changes, so a cache miss
    // forces a fresh getSession() with the updated JWT.
    const sessionTenantId = cached.session?.user?.tenantId;
    if (sessionTenantId === cachedTenantId) {
      return cached.session;
    }
    // Tenant changed — invalidate
    cached = null;
  }
  if (inflight) return inflight;

  // A lookup after the window only re-reads what the provider already shows
  // (#5130). The default broadcast made this tab's provider repeat the same
  // request on every page change. Without a known session (first lookup,
  // after clearSessionCache() in switch, refresh and 401 flows) the broadcast
  // stays: that is how the provider learns the new session. A known session
  // that changed, such as a school switch on another subdomain that replaced
  // the shared cookie, is announced as before so TenantGuard follows.
  const known = cached ? sessionSnapshot(cached.session) : null;

  // A request may only touch module state while it is still the current
  // `inflight`. clearSessionCache() (token refresh, tenant switch) nulls
  // `inflight`, so a lookup that was already in flight at that point must
  // neither write its stale, pre-refresh result back into the cache nor
  // clear a newer lookup that started after the invalidation.
  const request: Promise<Awaited<ReturnType<typeof getSession>>> = (
    known === null ? getSession() : getSession({ broadcast: false })
  )
    .then((session) => {
      if (known !== null && sessionSnapshot(session) !== known) {
        announceSessionChange();
      }
      if (inflight === request) {
        cachedTenantId = session?.user?.tenantId;
        cached = { session, expiry: Date.now() + TTL_MS };
      }
      return session;
    })
    .finally(() => {
      if (inflight === request) {
        inflight = null;
      }
    });
  inflight = request;

  return request;
}

/**
 * The signed-in gate of a staff request (`bffJson("tenant", …)`): the cached
 * session must grant access before anything goes out. A failed lookup is
 * `general.unavailable`, a session without access a 401 `general.permission`.
 *
 * The access token travels only in the session cookie: the BFF routes read it
 * server-side via auth(). A Bearer header on top sent the same token twice and
 * pushed large sessions past Node's header limit (HTTP 431, #3918), and the
 * browser session carries no token at all (#5005).
 */
export async function requireTenantSession(): Promise<void> {
  const session = await getSessionOrUnavailable();
  if (!hasSessionAccess(session)) throw authenticationRequiredError();
}

/**
 * Renews the session after the BFF answered 401 and resolves once the
 * renewed session is in place, so the caller repeats its request once. An
 * unrecoverable failure signs out (handleAuthFailure) and rejects with a 401
 * `general.permission`; an explicit tenant logout already owns the exit.
 */
export async function renewTenantSession(): Promise<void> {
  clearSessionCache();
  const refreshed = await handleAuthFailure();
  if (!refreshed) throw authenticationRequiredError();
  // The refresh does not touch the cookie (see handleAuthFailure); this
  // session lookup persists the refreshed tokens via Set-Cookie, so the
  // retry goes out with the fresh cookie.
  await requireTenantSession();
}
