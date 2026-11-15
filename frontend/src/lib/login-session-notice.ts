import { useEffect, useRef, useState } from "react";
import type { Session } from "next-auth";
import { signOut, useSession } from "next-auth/react";
import { useLatest } from "~/lib/hooks/use-latest";
import { hasSessionAccess } from "~/lib/session-access";
import { DELIBERATE_LOGOUT_KEY } from "~/lib/session-cache";

const SESSION_ERRORS = new Set(["SessionRequired", "SessionExpired"]);

/** Takes NextAuth's session error and its callbackUrl out of the address. */
function clearSessionErrorFromUrl() {
  const url = new URL(window.location.href);
  if (!SESSION_ERRORS.has(url.searchParams.get("error") ?? "")) return;
  url.searchParams.delete("error");
  url.searchParams.delete("callbackUrl");
  window.history.replaceState(
    {},
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
}

/**
 * Whether a login page shows „Sitzung abgelaufen“. NextAuth's
 * useSession({ required: true }) races the logout navigation and can
 * redirect to the login with ?error=SessionRequired before the page
 * unloads, so a deliberate logout shows no notice.
 */
export function useSessionExpiredNotice() {
  const [sessionExpired, setSessionExpired] = useState(false);
  useEffect(() => {
    const error = new URL(window.location.href).searchParams.get("error");
    if (!SESSION_ERRORS.has(error ?? "")) return;
    let deliberate = false;
    try {
      deliberate = sessionStorage.getItem(DELIBERATE_LOGOUT_KEY) === "1";
      sessionStorage.removeItem(DELIBERATE_LOGOUT_KEY);
    } catch {
      // sessionStorage unavailable: show the notice, it does no harm.
    }
    if (!deliberate) setSessionExpired(true);
    clearSessionErrorFromUrl();
  }, []);
  return [sessionExpired, setSessionExpired] as const;
}

interface StaleSessionSignOut {
  readonly status: "authenticated" | "loading" | "unauthenticated";
  readonly session: Session | null;
  /** Set while a sign-out runs or is done, so one stale session ends once. */
  readonly started: { current: boolean };
  readonly logger: { warn: (event: string, data: { error: string }) => void };
  /** The sign-out failed; a later call tries again. */
  readonly onFailure?: (cause: unknown) => void;
}

/**
 * Ends a session the backend no longer refreshes when a login page opens.
 * Without this the JWT callback keeps retrying the refused refresh, and the
 * stale cookie competes with the new sign-in. Answers null, at once, when
 * there is nothing to end or a sign-out already runs, so the page goes on
 * to its other checks in the same tick; otherwise the sign-out it started. Nothing is shown for a failure
 * unless the page asks for it: no one requested the cleanup.
 */
export function signOutStaleSession({
  status,
  session,
  started,
  logger,
  onFailure,
}: StaleSessionSignOut): Promise<void> | null {
  if (status !== "authenticated" || !session?.error || started.current) {
    return null;
  }
  started.current = true;
  return signOut({ redirect: false }).then(
    () => undefined,
    (cause: unknown) => {
      started.current = false;
      logger.warn("stale_session_signout_failed", {
        error: cause instanceof Error ? cause.message : String(cause),
      });
      onFailure?.(cause);
    },
  );
}

/**
 * The session a login page opens with: a stale one is signed out, one with
 * access calls `onAccess` (unless `paused`, while a later step such as the
 * second-factor setup runs). Answers whether the check still runs.
 */
export function useLoginSessionCheck({
  logger,
  onAccess,
  paused = false,
}: {
  readonly logger: StaleSessionSignOut["logger"];
  readonly onAccess: () => void;
  readonly paused?: boolean;
}): boolean {
  const { data: session, status } = useSession();
  const [checking, setChecking] = useState(true);
  const started = useRef(false);
  const onAccessRef = useLatest(onAccess);

  useEffect(() => {
    const cleanup = signOutStaleSession({ status, session, started, logger });
    if (cleanup) {
      void cleanup.then(() => setChecking(false));
      return;
    }
    // The layout's server snapshot carries no token (#4991); a session
    // without an error grants access, and the JWT callback renews its
    // tokens server-side (#5005). The check stays up while the page leaves.
    if (status === "authenticated" && hasSessionAccess(session) && !paused) {
      onAccessRef.current();
      return;
    }
    if (status !== "loading") setChecking(false);
  }, [status, session, paused, logger, onAccessRef]);

  return checking || status === "loading";
}
