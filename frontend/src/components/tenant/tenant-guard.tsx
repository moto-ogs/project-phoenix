"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { mutate } from "~/lib/swr";
import { hasSessionAccess } from "~/lib/session-access";
import { clearSessionCache } from "~/lib/session-cache";
import { performTenantSwitch } from "~/lib/tenant-api";
import { ApiError, onSessionTenantMismatch } from "~/lib/api-error";
import { installSessionTenantMismatchObserver } from "~/lib/session-tenant-mismatch-observer";
import { clientEnv } from "~/env.client";
import { performEndStaffPreview } from "~/lib/staff-preview-api";
import { useTenant } from "~/lib/tenant-context";
import { isDemoEntryPath } from "~/lib/demo-access";
import {
  TRAEGER_SIGN_IN_WITH_CODE_LABEL,
  isTraegerHandoffPath,
  traegerSignInWithCodeUrl,
} from "~/lib/traeger-handoff";
import { errorStatus } from "~/lib/expected-failure";
import { createLogger } from "~/lib/logger";
import { Button } from "~/components/ui/button";
import { credentialError } from "~/components/auth/credential-error";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { useApiErrorDisplay, useApiLoadError } from "~/contexts/ToastContext";
import { isTenantSessionEnding } from "~/lib/tenant-session-end";
import {
  beginSessionExit,
  reloadDocument,
  sessionExitRunning,
  sessionTreeState,
} from "~/lib/session-tree";
import {
  readSessionMark,
  sessionMarkName,
  shownSessionMark,
} from "~/lib/session-mark";
import { signOutSession } from "~/lib/tenant-session-cookie";
import { Loading } from "~/components/ui/loading";
import { SCHOOL_SIGN_IN_LABEL, schoolSignInTooltip } from "./school-sign-in";

const logger = createLogger({ component: "TenantGuard" });

const MAX_SWITCH_ATTEMPTS = 3;

// Kein Zugang zur Schule kommt als 401. Ohne diesen Abgleich spränge der
// Fehlerweg wortlos zur Anmeldung, statt den Grund zu nennen (#2517).
const NO_ACCESS = [
  "identity.tenant_access_denied",
  "identity.mfa_session_required",
] as const;

interface TenantGuardProps {
  readonly children: React.ReactNode;
  readonly redirect?: (url: string) => void;
}

// The school a switch loaded this tab's document for, and how often in a row
// (#3375, #8082): a session that keeps the other school after its switch
// would otherwise load the document again and again. A school ID and a
// count, no personal data; gone with the tab.
const SWITCH_RELOADS_KEY = "moto.tenant-switch-reloads";
const SWITCH_RELOADS_WINDOW_MS = 60_000;

function switchReloads(tenantId: string | null): number {
  try {
    const raw = sessionStorage.getItem(SWITCH_RELOADS_KEY);
    const noted = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    return noted?.tenantId === tenantId &&
      typeof noted.count === "number" &&
      typeof noted.at === "number" &&
      Date.now() - noted.at < SWITCH_RELOADS_WINDOW_MS
      ? noted.count
      : 0;
  } catch {
    return 0;
  }
}

/** Notes one more document the switch loads; false when nothing kept it. */
function noteSwitchReload(tenantId: string | null): boolean {
  const count = switchReloads(tenantId) + 1;
  try {
    sessionStorage.setItem(
      SWITCH_RELOADS_KEY,
      JSON.stringify({ tenantId, count, at: Date.now() }),
    );
  } catch {
    // Storage unavailable or full: checked below.
  }
  return switchReloads(tenantId) === count;
}

function clearSwitchReloads(): void {
  try {
    sessionStorage.removeItem(SWITCH_RELOADS_KEY);
  } catch {
    // Nothing kept.
  }
}

function browserRedirect(url: string): void {
  window.location.assign(url);
}

/** This page on the school's subdomain, for a tab still on path mode. */
function subdomainUrl(subdomain: string, pathSlug: string | null): string {
  const { protocol, port, pathname, search, hash } = window.location;
  const prefix = pathSlug ? `/${pathSlug}` : "";
  const path =
    prefix && (pathname === prefix || pathname.startsWith(`${prefix}/`))
      ? pathname.slice(prefix.length) || "/"
      : pathname;
  return `${protocol}//${subdomain}.${clientEnv.NEXT_PUBLIC_TENANT_DOMAIN}${port ? `:${port}` : ""}${path}${search}${hash}`;
}

/** How long the check of the session's school may take after a refusal. */
const REFUSAL_CHECK_MS = 10_000;
/** Pause before asking again while another session lookup still runs. */
const REFUSAL_RETRY_MS = 500;

// Installed when the guard's module loads: its children fetch before any
// effect of the guard runs (#5130).
installSessionTenantMismatchObserver();

/**
 * Client component that detects when the session's tenant differs from the
 * URL tenant and auto-switches the session to match the URL.
 *
 * Two-tab scenario:
 * 1. Tab A (school-a): session=school-a → no mismatch → renders normally
 * 2. Tab B (school-b): session=school-a, URL=school-b → mismatch → auto-switch
 * 3. Return to Tab A: SessionProvider refetches, session=school-b, URL=school-a → auto-switch back
 *
 * Operator isolation:
 * If a platform-scoped (operator) session leaks to a tenant subdomain via
 * shared cookies, the guard signs out immediately and redirects to the tenant
 * login page. This prevents operator sessions from accessing tenant-scoped UI.
 *
 * A mismatch that outlives the switch is retried a bounded number of times;
 * after that, or after a failed request, the guard offers "Erneut versuchen"
 * and "Neu anmelden" instead of waiting forever (#3375).
 *
 * RLS provides defense-in-depth during any brief mismatch window.
 *
 * The entry page of the public demo (#3462) is exempt: it replaces whatever
 * session the visitor brought, so switching or signing out first would end
 * the entry before the demo token is redeemed. The entry page of the
 * Absprung from the Träger portal (#4654) is exempt for the same reason.
 */

export function TenantGuard(props: TenantGuardProps) {
  const pathname = usePathname();
  const { tenant } = useTenant();
  if (
    isDemoEntryPath(pathname, tenant?.slug) ||
    isTraegerHandoffPath(pathname, tenant?.slug)
  ) {
    return <>{props.children}</>;
  }
  return <GuardedTenant {...props} />;
}

/** The school's login page, subdomain or path mode. */
function isLoginEntryPath(
  pathname: string | null,
  tenantSlug: string | undefined,
): boolean {
  if (pathname === null) return false;
  const path = pathname.replace(/\/+$/, "") || "/";
  return path === "/" || (!!tenantSlug && path === `/${tenantSlug}`);
}

function GuardedTenant({
  children,
  redirect = browserRedirect,
}: TenantGuardProps) {
  const { data: session, status, update } = useSession();
  const { tenant, tenantSlug, routingMode } = useTenant();
  // The login page clears an ended session itself and shows its form. Sending
  // it there again looped when the cookie could not be deleted, for a
  // session of a revoked family that the server reads as ended (#5399).
  const onLoginEntry = isLoginEntryPath(usePathname(), tenantSlug);
  const switchAttempts = useRef({
    targetTenantId: null as string | null,
    count: 0,
  });
  // "Erneut versuchen" asked for the next switch (see noteSwitchReload).
  const retryAsked = useRef(false);
  const switchInFlight = useRef(false);
  const [failedTenantId, setFailedTenantId] = useState<string | null>(null);
  const [mfaRequiredTenantId, setMfaRequiredTenantId] = useState<string | null>(
    null,
  );
  // A session from the Träger-Portal that the target school refused for
  // its remembered device (#6955): the way back leads to the Träger-Portal.
  const [traegerCodeTenantId, setTraegerCodeTenantId] = useState<string | null>(
    null,
  );
  const [recheck, setRecheck] = useState(0);
  // Why the switch failed, from the shared error path (#2517). Empty when
  // the switch went through but the old school kept coming back.
  const preloadPresenter = status === "authenticated" && !onLoginEntry;
  const {
    error: switchError,
    show: showSwitchError,
    clear: clearSwitchError,
  } = useApiLoadError({ preloadPresenter });
  const { show: showActionError } = useApiErrorDisplay(undefined, {
    preloadPresenter,
  });
  const [signingOutOperator, setSigningOutOperator] = useState(false);
  const [signingOutExpiredSession, setSigningOutExpiredSession] =
    useState(false);

  // The session the provider held when a tenant route refused a request
  // (#5130); null while nothing was refused. The session cache wakes the
  // provider; until it answers, nothing of this tab stays on screen.
  // After a tenant route refused a request (#5130) the page stays hidden
  // until a session lookup that started after the refusal names the school.
  // "checking": that lookup runs; "failed": it brought no valid answer in
  // time, so the person checks again. Never the old page meanwhile.
  const [refusal, setRefusalState] = useState<"checking" | "failed" | null>(
    null,
  );
  const refusalActive = useRef(false);
  // The refusal named another account (#5183), not another school: the
  // check ends on this school, and PersonalStorageGuard leaves the page.
  const [accountRefused, setAccountRefused] = useState(false);
  const setRefusal = useCallback((state: "checking" | "failed" | null) => {
    refusalActive.current = state !== null;
    setRefusalState(state);
  }, []);
  const refusalRun = useRef(0);
  const latest = useRef({
    session,
    tenantSlug,
    routingMode,
    tenant,
    update,
    redirect,
  });
  useEffect(() => {
    latest.current = {
      session,
      tenantSlug,
      routingMode,
      tenant,
      update,
      redirect,
    };
  });
  useEffect(
    () => () => {
      // A check still running must not touch an unmounted guard.
      refusalRun.current += 1;
    },
    [],
  );

  const checkSessionSchool = useCallback(() => {
    if (isTenantSessionEnding() || sessionExitRunning()) return;
    const run = ++refusalRun.current;
    setRefusal("checking");
    const deadline = Date.now() + REFUSAL_CHECK_MS;
    void (async () => {
      // update() asks the session route itself and returns its answer; it
      // returns nothing while another lookup of the provider runs.
      let answer: Awaited<ReturnType<typeof update>> | null | undefined;
      let timedOut = false;
      while (run === refusalRun.current && Date.now() < deadline) {
        const remaining = deadline - Date.now();
        const result = await Promise.race([
          latest.current.update().catch(() => null),
          new Promise<"timeout">((resolve) =>
            setTimeout(() => resolve("timeout"), remaining),
          ),
        ]);
        if (result === "timeout") {
          timedOut = true;
          break;
        }
        answer = result;
        if (answer !== undefined) break;
        await new Promise((resolve) => setTimeout(resolve, REFUSAL_RETRY_MS));
      }
      if (run !== refusalRun.current || isTenantSessionEnding()) return;
      if (!timedOut && answer === null) {
        // update() answers null for a failed lookup and for a session that
        // ended meanwhile (logout in another tab). Only the second has a way
        // forward: this school's login, without the old page in between.
        // Bounded by the check's deadline: a stalled read ends in the
        // failed state, never in an endless "checking".
        const abort = new AbortController();
        const stop = setTimeout(
          () => abort.abort(),
          Math.max(0, deadline - Date.now()),
        );
        const signedOut = await fetch("/api/auth/session", {
          cache: "no-store",
          signal: abort.signal,
        })
          .then(
            async (response) => response.ok && (await response.json()) === null,
          )
          .catch(() => false)
          .finally(() => clearTimeout(stop));
        if (run !== refusalRun.current || isTenantSessionEnding()) return;
        if (signedOut) {
          latest.current.redirect("/?error=SessionExpired");
          return;
        }
      }
      if (!answer) {
        logger.warn("tenant_session_refusal_check_failed", {
          timed_out: timedOut || answer === undefined,
        });
        setRefusal("failed");
        return;
      }
      // This tab's school: the cookie fits the page again. Another school:
      // the provider holds it now, and the mismatch handling below switches.
      setRefusal(null);
    })();
  }, [setRefusal]);

  useEffect(
    () =>
      onSessionTenantMismatch((code) => {
        if (isTenantSessionEnding()) return;
        const current = latest.current;
        // A tab still on path mode (<domain>/<school>/...) has no school in
        // its host; only the school's subdomain binds its requests.
        if (current.routingMode === "path" && current.tenant) {
          redirect(subdomainUrl(current.tenant.subdomain, current.tenantSlug));
          return;
        }
        // A running switch settles the school itself; a running check or
        // its failure stays as it is, so further refusals do not flicker.
        if (switchInFlight.current || refusalActive.current) return;
        // The provider already names another school: refusals are expected
        // and the mismatch handling below owns the screen (switch, its
        // failure, the explicit login). Another lookup now would only race
        // that flow, and its answer can write the old cookie back after the
        // sign-out of "Zur Schulanmeldung".
        const known = current.session;
        if (
          hasSessionAccess(known) &&
          known?.user?.tenantId !== current.tenant?.tenantId
        ) {
          return;
        }
        setAccountRefused(code === "identity.session_account_mismatch");
        checkSessionSchool();
      }),
    [redirect, checkSessionSchool],
  );

  // Any answer naming another school, also one that left before the
  // refusal, hands over to the mismatch handling below. An answer with this
  // tab's school counts only as the check's own result.
  const providerNamesOtherSchool =
    hasSessionAccess(session) && session?.user?.tenantId !== tenant?.tenantId;
  useEffect(() => {
    if (refusal === null || !providerNamesOtherSchool) return;
    refusalRun.current += 1;
    setRefusal(null);
  }, [refusal, providerNamesOtherSchool, setRefusal]);

  const sessionTenantId = session?.user?.tenantId;
  const sessionScope = session?.user?.scope;
  // The browser session carries no token (#5005); a stripped session always
  // carries an error.
  const sessionHasAccess = hasSessionAccess(session);
  const sessionError = session?.error;
  // Which session the errored answer describes (#8082).
  const sessionMark = session?.sessionMark ?? "";
  const urlTenantId = tenant?.tenantId ?? null;
  const urlSlug = tenant?.slug;
  // The backend resolves switch targets by subdomain, not by the slug
  // column — the two can differ (#1975).
  const urlSubdomain = tenant?.subdomain;

  // Auth.js can still report "authenticated" after the JWT callback has
  // stripped token/roles because refresh failed. Do not render tenant UI in
  // that limbo state; it makes real admins look like caregivers and produces
  // confusing forbidden screens.
  useEffect(() => {
    if (status !== "authenticated") return;
    if (sessionHasAccess || onLoginEntry) return;
    // A second tab can echo this logout's storage invalidation through its
    // provider. The explicit exit already owns cookie deletion/navigation.
    if (isTenantSessionEnding()) return;

    logger.warn("tenant_session_invalid", {
      error: sessionError,
    });

    setSigningOutExpiredSession(true);

    void (async () => {
      try {
        await mutate(() => true, undefined, { revalidate: false });
        clearSessionCache();
      } catch (err) {
        logger.warn("invalid_session_cache_clear_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      try {
        if (isTenantSessionEnding()) return;
        // Only the ended session (the one the session answer described):
        // the exit of session cookies keeps one another school's tab signed
        // in with meanwhile (#8082).
        await signOutSession("tenant", sessionMark);
      } catch (err) {
        logger.warn("invalid_session_signout_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        if (!isTenantSessionEnding()) redirect("/?error=SessionExpired");
      }
    })();
  }, [
    status,
    sessionHasAccess,
    sessionError,
    sessionMark,
    redirect,
    onLoginEntry,
  ]);

  // Operator session on tenant subdomain — sign out immediately
  useEffect(() => {
    if (status !== "authenticated" || !tenant) return;
    if (!sessionHasAccess) return;
    if (sessionScope !== "platform") return;

    logger.warn("operator_session_on_tenant", {
      url_slug: urlSlug,
      scope: sessionScope,
    });

    setSigningOutOperator(true);

    void (async () => {
      try {
        await mutate(() => true, undefined, { revalidate: false });
        clearSessionCache();
      } catch (err) {
        logger.warn("operator_signout_cache_clear_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      try {
        await signOutSession("tenant", shownSessionMark());
      } catch (err) {
        logger.warn("operator_signout_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        redirect("/");
      }
    })();
  }, [
    status,
    tenant,
    sessionScope,
    urlSlug,
    sessionHasAccess,
    sessionError,
    redirect,
  ]);

  useEffect(() => {
    // Only check when authenticated and tenant context is resolved
    if (status !== "authenticated" || !tenant) return;
    if (!sessionHasAccess) return;

    // Operator sessions are handled by the effect above
    if (sessionScope === "platform") return;

    // Skip when session has no tenantId
    if (sessionTenantId === undefined) return;

    // No mismatch — reset guard for future switches
    if (sessionTenantId === urlTenantId) {
      clearSwitchReloads();
      switchAttempts.current = { targetTenantId: null, count: 0 };
      setFailedTenantId(null);
      setMfaRequiredTenantId(null);
      setTraegerCodeTenantId(null);
      clearSwitchError();
      return;
    }

    // Retry limits apply to one target school. A different URL target must
    // not inherit an exhausted retry budget or an earlier failure message.
    if (switchAttempts.current.targetTenantId !== urlTenantId) {
      switchAttempts.current = { targetTenantId: urlTenantId, count: 0 };
      setFailedTenantId(null);
      setMfaRequiredTenantId(null);
      setTraegerCodeTenantId(null);
      clearSwitchError();
    }

    if (switchInFlight.current) return;
    // This document leaves for another school (the switcher, #8082): no
    // switch back to this one.
    if (sessionExitRunning()) return;

    // A switch that went through can still leave the old school behind: every
    // API response re-issues the session cookie it was asked with, so a
    // request of the old session that answers after the BFF session switch writes the old
    // school back (#3375). Those requests settle, so a bounded number of
    // repeats gets through; after that the person decides, not a spinner.
    if (
      switchAttempts.current.count >= MAX_SWITCH_ATTEMPTS ||
      switchReloads(urlTenantId) >= MAX_SWITCH_ATTEMPTS
    ) {
      setFailedTenantId(urlTenantId);
      return;
    }
    // The switch loads a new document: the bound across documents needs its
    // note first. Without one, only the person's own retry switches, once
    // per click (no loop of reloads).
    if (!noteSwitchReload(urlTenantId) && !retryAsked.current) {
      setFailedTenantId(urlTenantId);
      return;
    }
    retryAsked.current = false;
    switchAttempts.current.count += 1;
    switchInFlight.current = true;
    const switchTargetTenantId = urlTenantId;
    const switchTargetName = tenant.name;

    logger.info("tenant_mismatch_detected", {
      session_tenant_id: sessionTenantId,
      url_tenant_id: urlTenantId,
      url_slug: urlSlug,
      attempt: switchAttempts.current.count,
    });

    void (async () => {
      let signingOut = false;
      // The session the switch request carries: a refusal ends that one, not
      // a sign-in that took the cookie since (#8082).
      let markOfSwitch = "";
      try {
        // Ein Schulwechsel beendet die Mitarbeiter-Vorschau (#2893): erst
        // die Admin-Sitzung wiederherstellen, dann mit deren Token wechseln
        // — das Vorschau-Token selbst darf den Wechsel nicht ausführen.
        if (session?.user?.isPreview) {
          await performEndStaffPreview(update, mutate);
        }
        markOfSwitch = readSessionMark(
          sessionMarkName("tenant", clientEnv.NEXT_PUBLIC_TENANT_DOMAIN),
        );
        // The switch is an exit of the document's session (#8082): its own
        // answer drops the tree, and the document loads anew below.
        const endExit = beginSessionExit();
        try {
          await performTenantSwitch(urlSubdomain!, mutate);
        } catch (switchErr) {
          endExit();
          throw switchErr;
        }

        logger.info("tenant_auto_switched", {
          from_tenant_id: sessionTenantId,
          to_slug: urlSubdomain,
        });
        // A new document of this school: nothing of the session before stays,
        // also not the router's memory of its pages (#5130, #8082).
        signingOut = true;
        reloadDocument();
      } catch (err) {
        logger.error("tenant_auto_switch_failed", {
          error: err instanceof Error ? err.message : String(err),
          status: errorStatus(err),
          target_slug: urlSubdomain,
        });
        // The cookie changed during the switch (the staff preview ended):
        // the tree left, no way out shows in it any more; the next document
        // decides with the session the cookie holds (#8082).
        if (sessionTreeState().leaving) {
          signingOut = true;
          reloadDocument();
          return;
        }

        if (
          err instanceof ApiError &&
          err.code === "identity.tenant_access_denied"
        ) {
          try {
            await signOutSession("tenant", markOfSwitch);
            window.location.href = "/";
            signingOut = true;
          } catch (signOutErr) {
            logger.warn("tenant_auto_switch_signout_failed", {
              error:
                signOutErr instanceof Error
                  ? signOutErr.message
                  : String(signOutErr),
            });
            if (
              switchAttempts.current.targetTenantId === switchTargetTenantId
            ) {
              switchAttempts.current.count = MAX_SWITCH_ATTEMPTS;
            }
            setFailedTenantId(switchTargetTenantId);
            void showSwitchError(credentialError(err, NO_ACCESS), {
              object: `das Wechseln zu ${switchTargetName}`,
            });
          }
        } else {
          // A failed request is not the cookie race; repeating it unasked
          // would only hammer a backend that just said no.
          if (switchAttempts.current.targetTenantId === switchTargetTenantId) {
            switchAttempts.current.count = MAX_SWITCH_ATTEMPTS;
          }
          const needsMFA =
            err instanceof ApiError &&
            err.code === "identity.mfa_session_required";
          const needsTraegerCode =
            err instanceof ApiError &&
            err.code === "traeger.school_requires_code";
          setFailedTenantId(switchTargetTenantId);
          setMfaRequiredTenantId(needsMFA ? switchTargetTenantId : null);
          setTraegerCodeTenantId(
            needsTraegerCode ? switchTargetTenantId : null,
          );
          // The reason shows next to "Erneut versuchen" below; that button
          // is the retry, so the alert carries none of its own.
          void showSwitchError(credentialError(err, NO_ACCESS), {
            object: needsMFA
              ? switchTargetName
              : `das Wechseln zu ${switchTargetName}`,
          });
        }
      } finally {
        switchInFlight.current = false;
        // The session may have changed while the switch ran; look again.
        if (!signingOut) setRecheck((n) => n + 1);
      }
    })();
  }, [
    recheck,
    status,
    tenant,
    session,
    sessionScope,
    sessionTenantId,
    urlTenantId,
    urlSlug,
    urlSubdomain,
    update,
    sessionHasAccess,
    sessionError,
    showSwitchError,
    clearSwitchError,
  ]);

  if (refusal === "failed") {
    // Checking again is the way out. A relogin here would need the revoking
    // logout of reloginAtTenant, since only the revoked family makes a
    // cookie a late answer writes back worthless (#5194).
    return (
      <div className="mx-auto flex min-h-[200px] max-w-3xl items-center p-4">
        <div className="w-full space-y-3">
          <LoadErrorAlert error="moto kann gerade nicht prüfen, bei welcher Schule du angemeldet bist. Bitte versuche es gleich noch einmal." />
          <Button
            type="button"
            size="md"
            onClick={checkSessionSchool}
            tooltip="Prüft noch einmal, bei welcher Schule du angemeldet bist."
          >
            Erneut versuchen
          </Button>
        </div>
      </div>
    );
  }

  if (refusal === "checking") {
    return (
      <Loading
        message={
          accountRefused
            ? "Seite wird neu geladen..."
            : "Schule wird gewechselt..."
        }
      />
    );
  }

  // While session is loading, render children transparently.
  // Individual pages handle their own loading states (e.g. login form
  // uses opacity fade). Blocking here causes visible flicker on every
  // page load because the guard's placeholder has a different layout
  // than the page content that replaces it.
  if (status === "loading") {
    return <>{children}</>;
  }

  // Block render for operator sessions — covers both before effect fires
  // and during sign-out (signingOutOperator state)
  const isOperatorOnTenant =
    signingOutOperator ||
    (status === "authenticated" && sessionScope === "platform" && !!tenant);
  const switchFailed = failedTenantId === urlTenantId;

  if (
    (signingOutExpiredSession ||
      (status === "authenticated" && !sessionHasAccess) ||
      (isTenantSessionEnding() && !sessionHasAccess)) &&
    !onLoginEntry
  ) {
    return <Loading message="Sitzung wird erneuert..." />;
  }

  if (isOperatorOnTenant) {
    return <Loading message="Operator-Sitzung wird beendet..." />;
  }

  // Show switching state during mismatch auto-switch. Like its effect, only
  // for a session with access: an ended one belongs to the login page.
  if (
    status === "authenticated" &&
    sessionHasAccess &&
    tenant &&
    sessionTenantId !== undefined &&
    sessionTenantId !== urlTenantId
  ) {
    if (switchFailed) {
      return (
        <div className="mx-auto flex min-h-[200px] max-w-3xl items-center p-4">
          <div className="w-full space-y-3">
            <LoadErrorAlert
              error={
                switchError ??
                `Der Wechsel zu ${tenant.name} hat nicht geklappt. Bitte versuche es noch einmal. Wenn das nicht hilft, melde dich neu an.`
              }
            />
            <span className="flex flex-wrap gap-2">
              {traegerCodeTenantId === urlTenantId ? (
                <Button
                  type="button"
                  size="md"
                  tooltip="Öffnet die Anmeldung im Träger-Portal. Dort fragt moto nach dem Code."
                  onClick={() => {
                    globalThis.location.assign(traegerSignInWithCodeUrl());
                  }}
                >
                  {TRAEGER_SIGN_IN_WITH_CODE_LABEL}
                </Button>
              ) : mfaRequiredTenantId === urlTenantId ? (
                <Button
                  type="button"
                  size="md"
                  tooltip={schoolSignInTooltip(tenant.name)}
                  onClick={() => {
                    void import("./tenant-relogin")
                      .then(({ reloginAtTenant }) =>
                        reloginAtTenant(urlSubdomain!),
                      )
                      .catch((err: unknown) => {
                        void showActionError(err, { object: "die Abmeldung" });
                      });
                  }}
                >
                  {SCHOOL_SIGN_IN_LABEL}
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    size="md"
                    tooltip={`Versucht noch einmal, zu ${tenant.name} zu wechseln.`}
                    onClick={() => {
                      // The person asks again: a new budget, also for the
                      // documents the switch loads, and one switch even if
                      // the tab cannot keep the count.
                      clearSwitchReloads();
                      retryAsked.current = true;
                      switchAttempts.current = {
                        targetTenantId: urlTenantId,
                        count: 0,
                      };
                      setFailedTenantId(null);
                      clearSwitchError();
                      setRecheck((n) => n + 1);
                    }}
                  >
                    Erneut versuchen
                  </Button>
                  <Button
                    type="button"
                    size="md"
                    variant="outline"
                    tooltip="Meldet dich ab und öffnet die Anmeldung."
                    onClick={() => {
                      void signOutSession("tenant", shownSessionMark())
                        .then(() => {
                          window.location.href = "/";
                        })
                        .catch((err: unknown) => {
                          logger.warn("tenant_relogin_signout_failed", {
                            error:
                              err instanceof Error ? err.message : String(err),
                          });
                          void showActionError(err, {
                            object: "die Abmeldung",
                          });
                        });
                    }}
                  >
                    Neu anmelden
                  </Button>
                </>
              )}
            </span>
          </div>
        </div>
      );
    }
    return <Loading message="Schule wird gewechselt..." />;
  }

  return <>{children}</>;
}
