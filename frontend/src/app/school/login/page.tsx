"use client";

// Login des Schul-Portals ("moto schule", #2207). Spiegelt den Aufbau des
// Tenant-Logins (MFA-Kette inklusive Enrollment), aber ohne Tenant-Kontext,
// Passkeys und Eltern-Weiche: der Backend-Login pinnt selbst die Schule, an
// der das Konto eine Schul-Portal-Rolle hält.

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AuthShell, MotoBrand } from "~/components/auth/auth-shell";
import { AuthProgress } from "~/components/auth/auth-progress";
import { MFAChallengeForm } from "~/components/auth/mfa-challenge-form";
import { MFAEnrollmentScreen } from "~/components/auth/mfa-enrollment-screen";
import {
  PasswordLoginForm,
  type PasswordCredentials,
} from "~/components/auth/password-login-form";
import { Alert } from "~/components/ui/alert";
import { ApiError } from "~/lib/api-error";
import { portalNotBookedExplanation } from "~/lib/portal-not-booked";
import { schoolPath } from "~/lib/school-url";
import { useLoginSessionCheck } from "~/lib/login-session-notice";
import type { MFAStep } from "~/lib/sign-in-answer";
import { login as loginApi } from "~/lib/mfa-api";
import { createLogger } from "~/lib/logger";

const logger = createLogger({ component: "SchoolLoginPage" });

function openSchoolPortal() {
  window.location.href = schoolPath("/school");
}

const SHELL_COPY = {
  title: "Willkommen im Schulportal",
  subtitle: "Melden Sie sich mit Ihrem Konto für moto schule an.",
} as const;

interface MFAEnrollmentStep {
  enrollmentToken: string;
  email: string;
}

/** A refusal that is no error of the input, but the school's decision. */
type SchoolRefusal = "no_portal_role" | "not_booked";

function LoginForm() {
  const [email, setEmail] = useState("");
  const [refusal, setRefusal] = useState<SchoolRefusal | null>(null);
  const [awaitingRedirect, setAwaitingRedirect] = useState(false);
  const [mfaStep, setMfaStep] = useState<MFAStep | null>(null);
  const [enrollmentStep, setEnrollmentStep] =
    useState<MFAEnrollmentStep | null>(null);
  const targetTenantSlug = useSearchParams().get("tenant") ?? undefined;
  const isCheckingAuth = useLoginSessionCheck({
    logger,
    paused: enrollmentStep !== null,
    onAccess: openSchoolPortal,
  });

  const completeLogin = () => {
    setAwaitingRedirect(true);
    window.location.href = schoolPath("/school");
  };

  const submit = async (credentials: PasswordCredentials) => {
    setRefusal(null);
    setEmail(credentials.email);
    try {
      const response = await loginApi("school", {
        ...credentials,
        tenantSlug: targetTenantSlug,
      });
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
      completeLogin();
    } catch (err) {
      // Konto ohne Schul-Portal-Rolle: das Passwort war korrekt, die
      // Ablehnung kommt von der Rolle — die spezifische Meldung verrät
      // also nichts über fremde Konten und erspart Passwort-Reset-Schleifen.
      if (
        err instanceof ApiError &&
        err.code === "school.no_school_portal_role"
      ) {
        setRefusal("no_portal_role");
        return;
      }
      // Die Schule nutzt moto schule nicht (#4895): erklärt, kein Fehler.
      if (err instanceof ApiError && err.code === "module.not_booked") {
        setRefusal("not_booked");
        return;
      }
      throw err;
    }
  };

  return (
    <AuthShell
      {...SHELL_COPY}
      // Während moto prüft, gibt es nichts einzugeben.
      subtitle={isCheckingAuth ? undefined : SHELL_COPY.subtitle}
      variant="tenant"
      brand={<MotoBrand />}
    >
      {isCheckingAuth ? (
        <AuthProgress
          state="checking"
          title="Einen Moment bitte"
          description="moto prüft Ihre Anmeldung."
        />
      ) : mfaStep ? (
        <MFAChallengeForm
          scope="school"
          challengeToken={mfaStep.challengeToken}
          maskedEmail={mfaStep.maskedEmail}
          trustedDeviceEnabled={mfaStep.trustedDeviceEnabled}
          trustedDeviceDays={mfaStep.trustedDeviceDays}
          onSuccess={completeLogin}
          onCancel={() => setMfaStep(null)}
        />
      ) : enrollmentStep ? (
        <MFAEnrollmentScreen
          scope="school"
          bearerToken={enrollmentStep.enrollmentToken}
          userEmail={enrollmentStep.email}
          onExit={() => setEnrollmentStep(null)}
          onComplete={() => {
            setEnrollmentStep(null);
            completeLogin();
          }}
        />
      ) : (
        <PasswordLoginForm
          portal="school"
          onSubmit={submit}
          defaultEmail={email}
          leaving={awaitingRedirect}
          refusal={
            refusal === "not_booked" ? (
              <Alert
                type="info"
                message={portalNotBookedExplanation("school", "de")}
              />
            ) : refusal === "no_portal_role" ? (
              <Alert
                type="info"
                message="Dieses Konto hat keinen Zugang zum Schul-Portal. Bitte wenden Sie sich an Ihre OGS-Verwaltung."
              />
            ) : undefined
          }
        />
      )}
    </AuthShell>
  );
}

export default function SchoolLoginPage() {
  return (
    <Suspense
      fallback={
        <AuthShell
          title={SHELL_COPY.title}
          variant="tenant"
          brand={<MotoBrand />}
        >
          <AuthProgress
            state="checking"
            title="Einen Moment bitte"
            description="moto prüft Ihre Anmeldung."
          />
        </AuthShell>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
