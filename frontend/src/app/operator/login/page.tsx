"use client";

import { useState, useEffect, useRef } from "react";
// eslint-disable-next-line no-restricted-imports -- operator routes are not tenant-scoped
import { redirect, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { signOutStaleSession } from "~/lib/login-session-notice";
import type { MFAStep } from "~/lib/sign-in-answer";
import { AuthShell, OperatorBrand } from "~/components/auth/auth-shell";
import {
  PasswordLoginForm,
  type PasswordCredentials,
} from "~/components/auth/password-login-form";
import { Loading } from "~/components/ui/loading";
import { hasSessionAccess } from "~/lib/session-access";
import { operatorPath } from "~/lib/operator-url";
import { MFAChallengeForm } from "~/components/auth/mfa-challenge-form";
import { MFAEnrollmentScreen } from "~/components/auth/mfa-enrollment-screen";
import { login as loginApi } from "~/lib/mfa-api";
import { loginWithPasskey } from "~/lib/passkey-api";
import { createLogger } from "~/lib/logger";

const logger = createLogger({ component: "OperatorLoginPage" });

interface MFAEnrollmentStep {
  // enrollmentToken is the narrow-scope JWT issued by operator login when
  // MFA enrollment is required. Only authorizes /operator/auth/mfa/enroll/*.
  // A full session pair is minted by the confirm endpoint.
  enrollmentToken: string;
  email: string;
}

export default function OperatorLoginPage() {
  const [email, setEmail] = useState("");
  const [awaitingRedirect, setAwaitingRedirect] = useState(false);
  const [mfaStep, setMfaStep] = useState<MFAStep | null>(null);
  const [enrollmentStep, setEnrollmentStep] =
    useState<MFAEnrollmentStep | null>(null);
  const router = useRouter();
  const { data: session, status, update } = useSession();
  const cleanupStartedRef = useRef(false);
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  // Only the first answer counts: update() after a sign-in loads again and
  // must not unmount the step that waits for it.
  const [sessionKnown, setSessionKnown] = useState(false);
  useEffect(() => {
    if (status !== "loading") setSessionKnown(true);
  }, [status]);

  useEffect(() => {
    const cleanup = signOutStaleSession({
      status,
      session,
      started: cleanupStartedRef,
      logger,
    });
    if (!cleanup) return;
    setIsCleaningUp(true);
    void cleanup.then(() => setIsCleaningUp(false));
  }, [status, session]);

  // No browser session carries a token (#4991, #5005); a stripped session
  // carries an error and is cleared above instead of redirected.
  if (
    status === "authenticated" &&
    !enrollmentStep &&
    session?.user?.scope === "platform" &&
    hasSessionAccess(session)
  ) {
    redirect(operatorPath("/operator/organizations"));
  }

  if (
    (status === "loading" && !sessionKnown) ||
    isCleaningUp ||
    (status === "authenticated" && session?.error !== undefined)
  ) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-4">
        <Loading fullPage message="Einen Moment bitte …" />
      </div>
    );
  }

  // The BFF has installed the cookie. Refresh only the safe provider snapshot.
  const completeLogin = async () => {
    await update();
    setAwaitingRedirect(true);
    router.push(operatorPath("/operator/organizations"));
  };

  const submit = async (credentials: PasswordCredentials) => {
    setEmail(credentials.email);
    const response = await loginApi("operator", credentials);
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
  };

  const passkeyLogin = async () => {
    await loginWithPasskey("operator");
    await completeLogin();
  };

  return (
    <AuthShell
      title="Operator Dashboard"
      subtitle="Melde dich an, um Plattformbetrieb, Träger und Schulen zu verwalten."
      variant="operator"
      brand={<OperatorBrand />}
    >
      {mfaStep ? (
        <MFAChallengeForm
          scope="operator"
          challengeToken={mfaStep.challengeToken}
          maskedEmail={mfaStep.maskedEmail}
          trustedDeviceEnabled={mfaStep.trustedDeviceEnabled}
          trustedDeviceDays={mfaStep.trustedDeviceDays}
          onSuccess={completeLogin}
          onCancel={() => setMfaStep(null)}
        />
      ) : enrollmentStep ? (
        <MFAEnrollmentScreen
          scope="operator"
          bearerToken={enrollmentStep.enrollmentToken}
          userEmail={enrollmentStep.email}
          onExit={() => setEnrollmentStep(null)}
          onComplete={async () => {
            // The BFF has installed the session; discard the limited proof
            // only after the browser-safe session read succeeds.
            await completeLogin();
            setEnrollmentStep(null);
          }}
        />
      ) : (
        <PasswordLoginForm
          portal="operator"
          onSubmit={submit}
          onPasskey={passkeyLogin}
          defaultEmail={email}
          leaving={awaitingRedirect}
        />
      )}
    </AuthShell>
  );
}
