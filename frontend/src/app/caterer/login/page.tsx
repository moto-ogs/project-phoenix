"use client";

// Login of the caterer portal (ADR 0077). The backend checks e-mail and
// password and refuses every other kind of account like a wrong password.
// Where the caterer switched two-factor sign-in on (#4497), a code from the
// e-mail follows, unless this device is remembered; a passkey replaces both.
// The BFF installs the session.

import { useState } from "react";
import { AuthShell, MotoBrand } from "~/components/auth/auth-shell";
import { MFAChallengeForm } from "~/components/auth/mfa-challenge-form";
import {
  PasswordLoginForm,
  type PasswordCredentials,
} from "~/components/auth/password-login-form";
import { catererPath } from "~/lib/caterer-url";
import { useLoginSessionCheck } from "~/lib/login-session-notice";
import type { MFAStep } from "~/lib/sign-in-answer";
import { createLogger } from "~/lib/logger";
import { loginWithPasskey } from "~/lib/passkey-api";
import { portalPasswordLogin } from "~/lib/portal-password-login";
import { Loading } from "~/components/ui/loading";

const logger = createLogger({ component: "CatererLoginPage" });

const SHELL_COPY = {
  title: "Willkommen im Caterer-Portal",
  subtitle: "Melden Sie sich mit Ihrem Caterer-Konto an.",
} as const;

export default function CatererLoginPage() {
  const [email, setEmail] = useState("");
  const [awaitingRedirect, setAwaitingRedirect] = useState(false);
  const [mfaStep, setMfaStep] = useState<MFAStep | null>(null);
  const isCheckingAuth = useLoginSessionCheck({
    logger,
    onAccess: () => {
      window.location.href = catererPath("/caterer");
    },
  });

  // The BFF installed the session: after the password, the code or the
  // passkey.
  const completeLogin = () => {
    setAwaitingRedirect(true);
    window.location.href = catererPath("/caterer");
  };

  const submit = async (credentials: PasswordCredentials) => {
    setEmail(credentials.email);
    const result = await portalPasswordLogin(
      "caterer",
      credentials.email,
      credentials.password,
    );
    if (result.status === "mfa_required") {
      setMfaStep(result);
      return;
    }
    completeLogin();
  };

  const loginWithCatererPasskey = async () => {
    await loginWithPasskey("caterer");
    completeLogin();
  };

  return (
    <AuthShell {...SHELL_COPY} variant="tenant" brand={<MotoBrand />}>
      {mfaStep ? (
        <MFAChallengeForm
          scope="caterer"
          challengeToken={mfaStep.challengeToken}
          maskedEmail={mfaStep.maskedEmail}
          trustedDeviceEnabled={mfaStep.trustedDeviceEnabled}
          trustedDeviceDays={mfaStep.trustedDeviceDays}
          onSuccess={completeLogin}
          onCancel={() => setMfaStep(null)}
        />
      ) : isCheckingAuth ? (
        <Loading message="Sitzung wird überprüft …" />
      ) : (
        <PasswordLoginForm
          portal="caterer"
          onSubmit={submit}
          onPasskey={loginWithCatererPasskey}
          defaultEmail={email}
          leaving={awaitingRedirect}
        />
      )}
    </AuthShell>
  );
}
