"use client";

import type { ErrorCode } from "~/lib/error-codes.generated";
import { useCallback, useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import Image from "next/image";
import { Alert } from "~/components/ui/alert";
import { ApiError, wireErrorCode } from "~/lib/api-error";
import { trackTenantEvent } from "~/lib/analytics";
import { SmartRedirect } from "~/components/auth/smart-redirect";
import { AuthShell, MotoBrand } from "~/components/auth/auth-shell";
import { MFAChallengeForm } from "~/components/auth/mfa-challenge-form";
import { MFAEnrollmentScreen } from "~/components/auth/mfa-enrollment-screen";
import {
  PasswordLoginForm,
  type PasswordCredentials,
} from "~/components/auth/password-login-form";
import { useTenant } from "~/lib/tenant-context";
import { loginImageSrc } from "~/lib/tenant-api";
import { useTenantRouter } from "~/lib/tenant-router";
import { parentsPortalLoginUrl } from "~/lib/parent-url";
import { schoolPortalLoginUrl } from "~/lib/school-url";
import {
  getSmartRedirectPath,
  isSchoolPortalHandoffPath,
} from "~/lib/redirect-utils";
import { hasSessionAccess } from "~/lib/session-access";
import { useLoginSessionCheck } from "~/lib/login-session-notice";
import type { MFAStep } from "~/lib/sign-in-answer";
import { login as loginApi } from "~/lib/mfa-api";
import { loginWithPasskey } from "~/lib/passkey-api";
import { createLogger } from "~/lib/logger";
import { AuthProgress } from "~/components/auth/auth-progress";

const logger = createLogger({ component: "TenantLoginPage" });

/**
 * Grace period before an account is handed over to the portal it belongs
 * to. Long enough to read why the page is about to change, short enough
 * that nobody starts wondering whether the login worked.
 */
const WRONG_PORTAL_REDIRECT_MS = 2000;

/** The analytics reason of a refused login, by code; anything else is "error". */
const LOGIN_FAILURE_REASONS: Partial<Record<ErrorCode, string>> = {
  "identity.invalid_credentials": "invalid_credentials",
  "identity.session_account_inactive": "account_inactive",
};

/**
 * Set when the backend refused a login on PORTAL grounds: the credentials
 * were correct, but this account belongs to the parents portal
 * ("identity.use_parent_portal") or to moto schule ("identity.use_school_portal", #2207).
 *
 * redirectUrl is null only if the portal's hostname env var is missing at
 * runtime (env.js rejects that at build time). We then still explain the
 * situation, just without a link or an automatic jump.
 */
interface WrongPortalHint {
  portal: "parents" | "school";
  redirectUrl: string | null;
}

/** What the hint says, per portal. */
const WRONG_PORTAL_COPY = {
  parents: {
    // Kurz halten: das Ziel steht schon auf dem Link daneben, sonst
    // quetscht sich die Meldung im Kartenlayout.
    redirecting: "Dieses Konto ist ein Elternkonto. Sie werden weitergeleitet.",
    manual:
      "Dieses Konto ist ein Elternkonto. Bitte melden Sie sich im Elternportal an.",
    action: "Jetzt zum Elternportal",
  },
  school: {
    redirecting:
      "Dieses Konto gehört zu moto schule. Sie werden weitergeleitet.",
    manual:
      "Dieses Konto gehört zu moto schule. Bitte melden Sie sich dort an.",
    action: "Jetzt zu moto schule",
  },
} as const;

interface MFAEnrollmentStep {
  // enrollmentToken is the narrow-scope JWT issued by login when MFA is
  // required and the user has no credential yet. It only authorizes
  // /auth/mfa/enroll/* — a full session pair is minted by the confirm
  // endpoint and installed server-side once enrollment succeeds.
  enrollmentToken: string;
  email: string;
}

export default function HomePage() {
  const [email, setEmail] = useState("");
  const [awaitingRedirect, setAwaitingRedirect] = useState(false);
  const [mfaStep, setMfaStep] = useState<MFAStep | null>(null);
  const [enrollmentStep, setEnrollmentStep] =
    useState<MFAEnrollmentStep | null>(null);
  const [wrongPortalHint, setWrongPortalHint] =
    useState<WrongPortalHint | null>(null);
  const router = useTenantRouter();
  const { tenantSlug, tenant } = useTenant();
  const { data: session, status, update } = useSession();
  const loginTitle = tenant?.name?.trim() ? tenant.name : "Willkommen bei moto";
  const tenantLoginImageUrl = tenant?.settings?.loginImageUrl;
  const hasTenantLoginLogo = Boolean(tenantLoginImageUrl);
  const analyticsSchoolId = tenant?.tenantId?.toString() ?? null;
  // moto schule opens with this school picked.
  const schoolHandoffQuery = `?from=staff&tenant=${encodeURIComponent(tenantSlug)}`;
  const prepareSmartRedirect = useCallback(() => {
    logger.debug("valid session found, preparing smart redirect");
    setAwaitingRedirect(true);
  }, []);
  const isCheckingAuth = useLoginSessionCheck({
    logger,
    paused: enrollmentStep !== null,
    onAccess: prepareSmartRedirect,
  });

  const trackLoginEvent = (
    event: "login_failed",
    props?: Record<string, string | number | boolean>,
  ) => {
    if (!analyticsSchoolId) return;
    trackTenantEvent(event, analyticsSchoolId, props);
  };

  const isSmartRedirecting =
    awaitingRedirect && status === "authenticated" && hasSessionAccess(session);
  // A teacher-only account continues in moto schule, everyone else on the
  // start page of this school; the screen names the right one.
  const opensSchoolPortal =
    isSmartRedirecting &&
    isSchoolPortalHandoffPath(getSmartRedirectPath(session));

  // The BFF has already set the httpOnly session cookie. Read only the
  // browser-safe session to update the provider before SmartRedirect runs.
  const completeLogin = async () => {
    const current = await update();
    if (!hasSessionAccess(current))
      throw new Error("Session was not established");
    setAwaitingRedirect(true);
    router.refresh();
  };

  // Hand the account over to the portal it belongs to. Done in an effect
  // rather than a setTimeout inside the submit handler so React cancels the
  // pending jump if the user navigates away first.
  useEffect(() => {
    const target = wrongPortalHint?.redirectUrl;
    if (!target) return;

    const timer = setTimeout(() => {
      window.location.href = target;
    }, WRONG_PORTAL_REDIRECT_MS);

    return () => clearTimeout(timer);
  }, [wrongPortalHint]);

  const showWrongPortalHint = (code: ErrorCode | undefined): boolean => {
    if (
      code !== "identity.use_parent_portal" &&
      code !== "identity.use_school_portal"
    ) {
      return false;
    }

    const portal = code === "identity.use_parent_portal" ? "parents" : "school";
    let redirectUrl: string | null = null;
    try {
      redirectUrl =
        portal === "parents"
          ? parentsPortalLoginUrl("?from=staff")
          : schoolPortalLoginUrl(schoolHandoffQuery);
    } catch (urlErr) {
      logger.error("portal_url_unavailable", {
        portal,
        error: urlErr instanceof Error ? urlErr.message : String(urlErr),
      });
    }
    setWrongPortalHint({ portal, redirectUrl });
    // The analytics reason keeps its name from before the code rename (#2506).
    trackLoginEvent("login_failed", {
      reason: portal === "parents" ? "use_parent_portal" : "use_school_portal",
    });
    return true;
  };

  const submitLogin = async (credentials: PasswordCredentials) => {
    setWrongPortalHint(null);
    setEmail(credentials.email);
    try {
      const response = await loginApi("tenant", { ...credentials, tenantSlug });

      if (response.status === "mfa_required") {
        setMfaStep(response);
        return;
      }

      if (response.status === "mfa_enrollment_required") {
        setEnrollmentStep({
          enrollmentToken: response.enrollmentToken,
          email: credentials.email,
        });
        return;
      }

      await completeLogin();
    } catch (err) {
      // Wrong portal at the staff login. The backend accepted the password
      // and refused on role, so being specific leaks nothing — and the
      // generic "Anmeldung fehlgeschlagen" reads like a password problem,
      // which is what sent parents into repeated reset loops.
      if (err instanceof ApiError && showWrongPortalHint(err.code)) {
        return;
      }
      const code =
        err instanceof ApiError ? wireErrorCode(err.code) : undefined;
      trackLoginEvent("login_failed", {
        reason: (code && LOGIN_FAILURE_REASONS[code]) ?? "error",
      });
      throw err;
    }
  };

  const handlePasskeyLogin = async () => {
    setWrongPortalHint(null);
    try {
      await loginWithPasskey("tenant", { tenantSlug });
      await completeLogin();
    } catch (err) {
      if (err instanceof ApiError && showWrongPortalHint(err.code)) {
        return;
      }
      throw err;
    }
  };

  return (
    <AuthShell
      title={loginTitle}
      // Während moto prüft oder weiterleitet, gibt es nichts einzugeben.
      subtitle={
        isSmartRedirecting || isCheckingAuth
          ? undefined
          : "Melden Sie sich mit Ihrem Konto an."
      }
      variant="tenant"
      showMotoAttribution={hasTenantLoginLogo}
      brand={
        tenantLoginImageUrl ? (
          <Image
            src={loginImageSrc(tenantLoginImageUrl)}
            alt={`${tenant?.name ?? "Einrichtung"} Logo`}
            width={180}
            height={104}
            className="max-h-[104px] w-auto object-contain"
            priority
            unoptimized
          />
        ) : (
          <MotoBrand />
        )
      }
    >
      {isSmartRedirecting ? (
        <AuthProgress
          state="redirecting"
          title={
            // The session check is still up only when the account already
            // had a session as the page opened; after a sign-in here it has
            // long answered and shown the form.
            isCheckingAuth
              ? "Sie sind schon angemeldet"
              : "Anmeldung erfolgreich"
          }
          description={
            opensSchoolPortal
              ? "moto öffnet jetzt moto schule …"
              : "moto öffnet jetzt Ihre Startseite …"
          }
        />
      ) : isCheckingAuth ? (
        <AuthProgress
          state="checking"
          title="Einen Moment bitte"
          description="moto prüft, ob Sie schon angemeldet sind."
        />
      ) : mfaStep ? (
        <MFAChallengeForm
          scope="tenant"
          challengeToken={mfaStep.challengeToken}
          maskedEmail={mfaStep.maskedEmail}
          trustedDeviceEnabled={mfaStep.trustedDeviceEnabled}
          trustedDeviceDays={mfaStep.trustedDeviceDays}
          onSuccess={completeLogin}
          onError={(mfaError) => {
            if (
              mfaError instanceof ApiError &&
              showWrongPortalHint(mfaError.code)
            ) {
              setMfaStep(null);
              return true;
            }
            return false;
          }}
          onCancel={() => setMfaStep(null)}
        />
      ) : enrollmentStep ? (
        <MFAEnrollmentScreen
          scope="tenant"
          bearerToken={enrollmentStep.enrollmentToken}
          userEmail={enrollmentStep.email}
          onExit={() => setEnrollmentStep(null)}
          onComplete={async () => {
            await completeLogin();
            setEnrollmentStep(null);
          }}
        />
      ) : (
        <PasswordLoginForm
          portal="tenant"
          onSubmit={submitLogin}
          onPasskey={handlePasskeyLogin}
          defaultEmail={email}
          leaving={awaitingRedirect}
          refusal={
            wrongPortalHint ? (
              <Alert
                type="info"
                message={
                  wrongPortalHint.redirectUrl
                    ? WRONG_PORTAL_COPY[wrongPortalHint.portal].redirecting
                    : WRONG_PORTAL_COPY[wrongPortalHint.portal].manual
                }
                action={
                  wrongPortalHint.redirectUrl ? (
                    <a
                      href={wrongPortalHint.redirectUrl}
                      className="font-medium whitespace-nowrap underline underline-offset-2"
                    >
                      {WRONG_PORTAL_COPY[wrongPortalHint.portal].action}
                    </a>
                  ) : undefined
                }
              />
            ) : undefined
          }
        />
      )}

      {awaitingRedirect &&
        status === "authenticated" &&
        hasSessionAccess(session) && (
          <SmartRedirect
            onRedirect={(path) => {
              logger.info("redirecting based on user permissions", { path });
              if (isSchoolPortalHandoffPath(path)) {
                window.location.href = schoolPortalLoginUrl(schoolHandoffQuery);
                return;
              }
              router.push(path);
            }}
          />
        )}
    </AuthShell>
  );
}
