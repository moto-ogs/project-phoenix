"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
// eslint-disable-next-line no-restricted-imports -- parent routes are not tenant-scoped
import { redirect, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { Alert } from "~/components/ui/alert";
import { FormErrorAlert } from "~/components/ui/form-error-alert";
import {
  AuthShell,
  AuthShellSkeleton,
  MotoBrand,
} from "~/components/auth/auth-shell";
import { buildParentAuthShellCopy } from "~/components/auth/parent-auth-shell-copy";
import {
  PasswordLoginForm,
  type PasswordCredentials,
  type PasswordLoginCopy,
} from "~/components/auth/password-login-form";
import { LanguageSwitcher } from "~/components/parent/language-switcher";
import { useApiFormError } from "~/contexts/ToastContext";
import { ApiError, unavailableApiError } from "~/lib/api-error";
import {
  MFAChallengeForm,
  type MFAChallengeCopy,
} from "~/components/auth/mfa-challenge-form";
import { signOutStaleSession } from "~/lib/login-session-notice";
import { portalPasswordLogin } from "~/lib/portal-password-login";
import type { MFAStep } from "~/lib/sign-in-answer";
import { createLogger } from "~/lib/logger";
import { parentPath } from "~/lib/parent-url";
import { holidayRegistrationReturnPath } from "~/lib/parent-holiday-registration";
import { portalNotBookedExplanation } from "~/lib/portal-not-booked";
import { normalizeLocale } from "~/i18n/locales";
import { clientEnv } from "~/env.client";

const logger = createLogger({ component: "ParentLoginPage" });

/**
 * Absolute URL der Schul-Anmeldung. Anders als das Elternportal liegt das
 * Personal-Portal pro Schule auf einer eigenen Subdomain, und welche Schule
 * gemeint ist, weiss das Elternportal nicht. Deshalb zeigt der Link auf die
 * Einrichtungs-Auswahl unter der blanken Domain (src/app/page.tsx).
 *
 * NEXT_PUBLIC_TENANT_DOMAIN traegt keinen Port, der kommt aus dem aktuellen
 * Fenster — dieselbe Konstruktion wie in src/app/page.tsx:52-58.
 */
function staffLoginUrl(): string {
  const portSuffix = window.location.port ? `:${window.location.port}` : "";
  return `${window.location.protocol}//${clientEnv.NEXT_PUBLIC_TENANT_DOMAIN}${portSuffix}/`;
}

type ParentSignInTranslate = ReturnType<typeof useTranslations<"parentSignIn">>;

/** The code step in the parent's language (#7051). */
function challengeCopy(t: ParentSignInTranslate): MFAChallengeCopy {
  return {
    back: t("challenge.back"),
    backLabel: t("challenge.backLabel"),
    title: t("challenge.title"),
    sentTo: (email) =>
      t.rich("challenge.sentTo", {
        email: "",
        b: () => <span className="font-medium text-gray-800">{email}</span>,
      }),
    codeLabel: t("challenge.codeLabel"),
    digitLabel: (position) => t("challenge.digitLabel", { position }),
    checking: t("challenge.checking"),
    autoCheck: t("challenge.autoCheck"),
    question: t("challenge.question"),
    remember: t("challenge.remember"),
    rememberHint: (days) => t("challenge.rememberHint", { days }),
    once: t("challenge.once"),
    onceHint: t("challenge.onceHint"),
    enterCodeFirst: t("challenge.enterCodeFirst"),
    removeDevicesHint: t("challenge.removeDevicesHint"),
    resend: t("challenge.resend"),
    resendIn: (seconds) => t("challenge.resendIn", { seconds }),
    resending: t("challenge.resending"),
    verifyObject: t("challenge.verifyObject"),
    resendObject: t("challenge.resendObject"),
  };
}

/** The password step in the parent's language. */
function loginCopy(
  t: ReturnType<typeof useTranslations<"parentLogin">>,
  tErrorCatalog: ReturnType<typeof useTranslations<"errorCatalog">>,
  tReset: ReturnType<typeof useTranslations<"parentPasswordResetModal">>,
): PasswordLoginCopy {
  return {
    emailLabel: t("emailLabel"),
    passwordLabel: t("passwordLabel"),
    showPassword: t("showPassword"),
    hidePassword: t("hidePassword"),
    forgotPassword: t("forgotPassword"),
    submit: t("submit"),
    submitting: t("submitting"),
    errorObject: t("errorObject"),
    missingEmail: t("errors.missingEmail"),
    missingPassword: t("errors.missingPassword"),
    missingCredentials: t("errors.missingCredentials"),
    rateLimited: t("errors.rateLimited"),
    sessionExpired: tErrorCatalog("loginNotice"),
    reset: {
      title: tReset("title"),
      description: tReset("description"),
      emailLabel: tReset("emailLabel"),
      invalidEmail: tReset("invalidEmail"),
      cancel: tReset("cancel"),
      submit: tReset("submit"),
      submitting: tReset("submitting"),
      successTitle: tReset("successTitle"),
      successMessage: tReset("successMessage"),
      successHint: tReset("successHint"),
      close: tReset("close"),
      errorObject: tReset("errorObject"),
      rateLimitWait: (countdown) => tReset("rateLimitWait", { countdown }),
    },
  };
}

export default function ParentLoginPage() {
  // useSearchParams verlangt eine Suspense-Grenze (siehe frontend/CLAUDE.md).
  return (
    <Suspense fallback={<AuthShellSkeleton />}>
      <ParentLoginForm />
    </Suspense>
  );
}

/** A refusal that is no error of the input: the wrong place or the school. */
type ParentRefusal = "staff_account" | "not_booked";

function ParentLoginForm() {
  const t = useTranslations("parentLogin");
  const tErrorCatalog = useTranslations("errorCatalog");
  const tAuthShell = useTranslations("parentAuthShell");
  const tReset = useTranslations("parentPasswordResetModal");
  const tSignIn = useTranslations("parentSignIn");
  const mfaCopy = useMemo(() => challengeCopy(tSignIn), [tSignIn]);
  const formCopy = useMemo(
    () => loginCopy(t, tErrorCatalog, tReset),
    [t, tErrorCatalog, tReset],
  );
  // Where the account has the code by e-mail switched on (#7051), the
  // password leads to this second step.
  const [mfaStep, setMfaStep] = useState<MFAStep | null>(null);
  const [email, setEmail] = useState("");
  const [refusal, setRefusal] = useState<ParentRefusal | null>(null);
  // A stale session that could not be ended keeps the form locked.
  const cleanupErrors = useApiFormError();
  const { show: showCleanupError } = cleanupErrors;
  const locale = normalizeLocale(useLocale());
  const searchParams = useSearchParams();
  // Gesetzt, wenn die Personal-Anmeldung ein Elternkonto hierher geschickt hat.
  const cameFromStaffLogin = searchParams.get("from") === "staff";
  // Die Ferienanmeldung schickt Eltern mit Konto hierher und will sie nach
  // dem Login wieder im Formular haben (#6671). Nur dieses eine Ziel gilt.
  const returnPath = holidayRegistrationReturnPath(searchParams.get("next"));
  // Erst nach dem Mount, weil die URL window.location.port braucht und die
  // Seite serverseitig vorgerendert wird.
  const [staffUrl, setStaffUrl] = useState<string | null>(null);
  useEffect(() => setStaffUrl(staffLoginUrl()), []);
  // Gesetzt, sobald die BFF die Sitzung installiert hat: Die Seite wechselt
  // in die App und bleibt bis dahin gesperrt.
  const [awaitingRedirect, setAwaitingRedirect] = useState(false);
  const { data: session, status } = useSession();
  const cleanupStartedRef = useRef(false);
  const [cleanupAttempt, setCleanupAttempt] = useState(0);
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  const testimonialPanelCopy = useMemo(
    () => buildParentAuthShellCopy(tAuthShell),
    [tAuthShell],
  );
  // A session the callback stripped (no usable access token) carries an
  // error and stays on the form. No browser session carries a token
  // (#4990, #5005); the server checks the cookie, so a signed-in parent
  // opening /login is still sent to the portal.
  const isRedirectingToParent =
    status === "authenticated" &&
    session?.user?.scope === "parent" &&
    session.error === undefined;
  const isSessionSettling =
    status === "loading" ||
    isCleaningUp ||
    isRedirectingToParent ||
    (status === "authenticated" && session?.error !== undefined);

  useEffect(() => {
    const cleanup = signOutStaleSession({
      status,
      session,
      started: cleanupStartedRef,
      logger,
      // The stale session keeps the form locked: say so, and let
      // Wiederholen run the cleanup again.
      onFailure: (cause) => {
        void showCleanupError(unavailableApiError(cause), {
          object: t("errorObject"),
          retry: () => setCleanupAttempt((current) => current + 1),
        });
      },
    });
    if (!cleanup) return;
    setIsCleaningUp(true);
    void cleanup.then(() => setIsCleaningUp(false));
  }, [status, session, cleanupAttempt, showCleanupError, t]);

  // Ein Elternteil, das bereits angemeldet ist und /login direkt aufruft,
  // geht in die App. Nach einer Anmeldung hier lädt completeLogin die App
  // neu; die Weiterleitung greift dann nicht zusätzlich (#7051).
  if (isRedirectingToParent && !awaitingRedirect) {
    redirect(returnPath ?? parentPath("/parents"));
  }

  // Die BFF hat die Sitzung installiert: nach dem Passwort oder dem Code.
  const completeLogin = () => {
    setAwaitingRedirect(true);
    window.location.href = returnPath ?? parentPath("/parents");
  };

  const submit = async (credentials: PasswordCredentials) => {
    setRefusal(null);
    cleanupErrors.clear();
    setEmail(credentials.email);
    try {
      const result = await portalPasswordLogin(
        "parent",
        credentials.email,
        credentials.password,
      );
      if (result.status === "mfa_required") {
        setMfaStep(result);
        return;
      }
      completeLogin();
    } catch (err) {
      // The 403 follows a correct password check, so naming a staff
      // account tells a stranger nothing.
      if (err instanceof ApiError && err.code === "care.not_a_guardian") {
        setRefusal("staff_account");
        return;
      }
      // Keine Schule des Kontos nutzt das Elternportal (#4895): kein Fehler
      // der Eingabe, die Schule entscheidet.
      if (err instanceof ApiError && err.code === "module.not_booked") {
        setRefusal("not_booked");
        return;
      }
      throw err;
    }
  };

  return (
    <AuthShell
      eyebrow={t("eyebrow")}
      title={t("title")}
      subtitle={t("subtitle")}
      variant="parents"
      brand={<MotoBrand />}
      footer={<LanguageSwitcher />}
      testimonialPanelCopy={testimonialPanelCopy}
    >
      {mfaStep ? (
        <MFAChallengeForm
          scope="parent"
          copy={mfaCopy}
          challengeToken={mfaStep.challengeToken}
          maskedEmail={mfaStep.maskedEmail}
          trustedDeviceEnabled={mfaStep.trustedDeviceEnabled}
          trustedDeviceDays={mfaStep.trustedDeviceDays}
          onSuccess={completeLogin}
          onCancel={() => setMfaStep(null)}
        />
      ) : (
        <PasswordLoginForm
          portal="parent"
          copy={formCopy}
          onSubmit={submit}
          defaultEmail={email}
          locked={isSessionSettling}
          leaving={awaitingRedirect}
          refusal={
            cleanupErrors.error ? (
              <FormErrorAlert message={cleanupErrors.error} />
            ) : refusal === "not_booked" ? (
              <Alert
                type="info"
                message={portalNotBookedExplanation("parent", locale)}
              />
            ) : refusal === "staff_account" ? (
              <Alert
                type="info"
                message={t("errors.notAGuardian")}
                action={
                  staffUrl ? (
                    <a
                      href={staffUrl}
                      className="font-medium whitespace-nowrap underline underline-offset-2"
                    >
                      {t("staffLoginLink")}
                    </a>
                  ) : undefined
                }
              />
            ) : undefined
          }
          notice={
            cameFromStaffLogin ? (
              <Alert type="info" message={t("fromStaffBanner")} />
            ) : undefined
          }
        />
      )}
    </AuthShell>
  );
}
