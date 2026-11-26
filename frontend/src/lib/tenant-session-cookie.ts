import { clientEnv } from "~/env.client";
import { apiErrorFromResponse, unavailableApiError } from "./api-error";
import {
  END_SESSION_HEADER,
  SESSION_REPLACED_HEADER,
  endSessionHeader,
  readSessionMark,
  sessionMarkName,
  shownSessionMark,
} from "./session-mark";
import { PORTAL_ROUTES, type PortalKey } from "./portal-paths";
import {
  beginSessionExit,
  discardSessionTree,
  reloadDocument,
  sessionTreeState,
} from "./session-tree";
import { createLogger } from "./logger";
import { markTenantSessionNavigation } from "./tenant-session-end";

const logger = createLogger({ component: "TenantSessionCookie" });

/**
 * Auth.js' tenant signout protocol with cancellation between its CSRF and
 * cookie-deletion requests. The SDK's signOut cannot receive an AbortSignal.
 * Navigation belongs to the current attempt, not a late SDK continuation.
 *
 * `revoked`: the server ended the session's family. A deletion that fails
 * or that Auth.js refuses then still navigates (the target guard can retry
 * it; the cookie left behind is dead). Without a revocation it throws and
 * the page keeps its retry: the live cookie would sign the person back in.
 */
export async function signOutTenant(
  {
    callbackUrl,
    revoked,
    mark,
    onDeleted,
  }: {
    callbackUrl: string;
    revoked: boolean;
    /** The mark of the tree the exit ends (shownSessionMark). */
    mark: string;
    /** Runs once Auth.js deleted the cookie, before the navigation. */
    onDeleted?: () => void;
  },
  signal: AbortSignal,
): Promise<void> {
  let url: string | undefined;
  try {
    url = await deleteSessionCookie(
      "/api/auth",
      callbackUrl,
      { portal: "tenant", mark },
      signal,
    );
    // The data went only now: not if another school's sign-in took the
    // cookie since its deletion (#8082).
    if (onDeleted) {
      if (tenantSessionReplaced("")) throw new SessionReplaced();
      onDeleted();
    }
  } catch (error) {
    signal.throwIfAborted();
    // The cookie went (its own deletion dropped the tree) or another session
    // took it: the document loads what the cookie holds now.
    if (
      error instanceof SessionReplaced ||
      (!revoked && sessionTreeState().leaving)
    ) {
      leaveReplacedSession();
      markTenantSessionNavigation(signal);
      return;
    }
    if (!revoked) throw error;
    logger.warn("revoked_tenant_cookie_kept", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  // The callers clear personal storage before the navigation (a revoked
  // session before this request, else in onDeleted). Its owner-key removal
  // invalidates other tabs through SWRScopeBoundary, without waking this
  // document's SessionProvider while navigation is pending.
  // Keep the menu's relative home destination, as its SDK redirect:false
  // path did; Auth.js' configured base URL can be a different tenant host.
  // Nothing of the session renders again (#8082).
  discardSessionTree();
  window.location.href = callbackUrl === "/" ? "/" : (url ?? callbackUrl);
  markTenantSessionNavigation(signal);
}

/**
 * The cookie holds another session than the one the exit began with:
 * another tab (on the shared tenant cookie also another school's, which no
 * event of this origin reports) signed in meanwhile. Its cookie is not the
 * exit's to delete.
 */
export class SessionReplaced extends Error {}

/**
 * Whether the cookie of `portal` holds another session than `mark` (the
 * tree's, shownSessionMark). A deletion left nothing to replace. The exit
 * then ends nothing: neither the revocation nor Auth.js' signout may reach
 * the new session.
 */
export function sessionReplaced(portal: PortalKey, mark: string): boolean {
  const now = readSessionMark(
    sessionMarkName(portal, clientEnv.NEXT_PUBLIC_TENANT_DOMAIN),
  );
  return now !== mark && now !== "";
}

/** The tenant's sessionReplaced. */
export function tenantSessionReplaced(mark: string): boolean {
  return sessionReplaced("tenant", mark);
}

/**
 * Leaves a tree whose cookie another session took: it goes at once, and the
 * document loads the new session, never the old tree again.
 */
export function leaveReplacedSession(): void {
  discardSessionTree();
  reloadDocument();
}

/**
 * Auth.js' signout protocol (CSRF, then the deletion) for the session of
 * `mark` at `basePath`, without the SDK: its signOut asks for the session
 * once more after the cookie is gone and holds the old page until that
 * answers. The exit of session cookies deletes nothing of another session
 * (END_SESSION_HEADER) and says so: SessionReplaced. Answers the url Auth.js
 * named; throws when it refused or failed.
 */
async function deleteSessionCookie(
  basePath: string,
  callbackUrl: string,
  { portal, mark }: { portal: PortalKey; mark: string },
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  const csrf = await fetch(`${basePath}/csrf`, { signal });
  signal?.throwIfAborted();
  if (!csrf.ok) throw await apiErrorFromResponse(csrf, "Logout CSRF failed");
  const { csrfToken } = (await csrf.json()) as { csrfToken?: unknown };
  signal?.throwIfAborted();
  if (typeof csrfToken !== "string" || !csrfToken) {
    throw unavailableApiError(new Error("Logout CSRF token missing"));
  }
  // From the signout on, the deletion is this exit's: the tree leaves and
  // the caller navigates (a deletion without an exit reloads the document).
  // A failed exit ends here; a successful one with the document.
  const endExit = beginSessionExit();
  try {
    const response = await fetch(`${basePath}/signout`, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Auth-Return-Redirect": "1",
        [END_SESSION_HEADER]: endSessionHeader(portal, mark),
      },
      body: new URLSearchParams({ csrfToken, callbackUrl }),
    });
    signal?.throwIfAborted();
    if (response.headers.has(SESSION_REPLACED_HEADER))
      throw new SessionReplaced();
    return await signedOutUrl(response);
  } catch (error) {
    endExit();
    throw error;
  }
}

/**
 * The url of Auth.js' signout answer. It answers a refused signout (a
 * failed CSRF check) with 200 as well, naming its error page instead of the
 * callback: that throws like a failed one (refusedSignOut).
 */
async function signedOutUrl(response: Response): Promise<string> {
  if (!response.ok) throw await apiErrorFromResponse(response, "Logout failed");
  const { url } = (await response.json()) as { url?: unknown };
  if (refusedSignOut(url))
    throw unavailableApiError(new Error("Logout refused"));
  return url as string;
}

/**
 * Whether Auth.js' signout answer (`{ url }`, also the SDK's) is no
 * deletion: no url, or its error page.
 */
function refusedSignOut(url: unknown): boolean {
  return (
    typeof url !== "string" ||
    new URL(url, location.href).searchParams.has("error")
  );
}

/**
 * Auth.js' signout protocol for a portal (`basePath`, #8082). Throws when
 * the cookie could not be deleted, SessionReplaced when another session
 * took it; the caller navigates.
 */
export async function signOutPortal(
  basePath: string,
  callbackUrl: string,
  /** The portal and the mark of the session the exit ends (SessionReplaced). */
  session: { portal: PortalKey; mark: string },
): Promise<void> {
  await deleteSessionCookie(basePath, callbackUrl, session);
}

/**
 * Ends one session of `portal` through Auth.js' protocol (#8082): by default
 * the one the tree shows, or the one an errored answer described. A cookie
 * another tab's sign-in took meanwhile stays (SessionReplaced counts as
 * done: nothing of that session is left here). Throws when the cookie could
 * not be deleted; the caller navigates.
 */
export async function signOutSession(
  portal: PortalKey,
  mark: string = shownSessionMark(),
): Promise<void> {
  try {
    await signOutPortal(
      PORTAL_ROUTES[portal].basePath,
      window.location.origin,
      {
        portal,
        mark,
      },
    );
  } catch (error) {
    if (error instanceof SessionReplaced) return;
    // The cookie went before the answer broke: the tree left with it, and
    // no caller's retry is left on screen; the document loads anew.
    if (sessionTreeState().leaving) reloadDocument();
    throw error;
  }
}
