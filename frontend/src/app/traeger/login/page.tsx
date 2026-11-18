"use client";

// Login des Träger-Portals ("moto träger", #4649). Spiegelt den Aufbau des
// Schul-Logins mit einem Zwischenschritt: Wer zu mehreren Trägern gehört,
// wählt den Träger aus. Danach ist der zweite Faktor immer Pflicht (#4651):
// ein Code per E-Mail, beim ersten Mal mit Einrichtung. Ein Gerät merkt sich
// das Träger-Portal nicht.

import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { AuthShell, MotoBrand } from "~/components/auth/auth-shell";
import { AuthProgress } from "~/components/auth/auth-progress";
import { LOGIN_REFUSALS } from "~/components/auth/credential-error";
import { MFAChallengeForm } from "~/components/auth/mfa-challenge-form";
import { MFAEnrollmentScreen } from "~/components/auth/mfa-enrollment-screen";
import {
  PasswordLoginForm,
  useLoginAttempt,
  type PasswordCredentials,
} from "~/components/auth/password-login-form";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { ChoiceTile } from "~/components/ui/choice-tile";
import { FormErrorAlert } from "~/components/ui/form-error-alert";
import { Radio } from "~/components/ui/radio";
import { useApiFormError } from "~/contexts/ToastContext";
import { hasSessionAccess } from "~/lib/session-access";
import { createLogger } from "~/lib/logger";
import { signOutStaleSession } from "~/lib/login-session-notice";
import { endTraegerSession } from "~/lib/shell-auth-context";
import {
  clearTraegerSignInWithCode,
  isTraegerSignInWithCodeRequested,
  requestTraegerSignInWithCode,
  serverTraegerSignInWithCode,
  subscribeTraegerSignInWithCode,
} from "~/lib/traeger-sign-in-with-code";
import type { MFAStep, TraegerChoice } from "~/lib/sign-in-answer";
import { traegerLogin } from "~/lib/traeger-api";
import { TRAEGER_SIGN_IN_WITH_CODE_PARAM } from "~/lib/login-params";
import { traegerPath } from "~/lib/traeger-url";

const logger = createLogger({ component: "TraegerLoginPage" });

const SHELL_COPY = {
  title: "Willkommen im Träger-Portal",
  subtitle: "Melde dich mit deinem moto-Konto an.",
} as const;

interface EnrollmentStep {
  readonly enrollmentToken: string;
  readonly organizationId: string;
}

function LoginForm() {
  const [credentials, setCredentials] = useState<PasswordCredentials>({
    email: "",
    password: "",
  });
  // A school asked for a sign-in with code (#6955): the next sign-in in
  // this tab ignores the remembered device. Read, never consumed, while
  // rendering; the server renders no hint.
  const withCode = useSyncExternalStore(
    subscribeTraegerSignInWithCode,
    isTraegerSignInWithCodeRequested,
    serverTraegerSignInWithCode,
  );
  const [awaitingRedirect, setAwaitingRedirect] = useState(false);
  const [choices, setChoices] = useState<readonly TraegerChoice[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mfaStep, setMfaStep] = useState<MFAStep | null>(null);
  const [enrollmentStep, setEnrollmentStep] = useState<EnrollmentStep | null>(
    null,
  );
  // The Träger choice after the password, with its own error path.
  const choice = useLoginAttempt("traeger");
  // Ending a session a sign-in with code is to replace (#6955).
  const endErrors = useApiFormError();
  const [endingSession, setEndingSession] = useState(false);
  const latestChoiceRef = useRef<() => void>(() => undefined);
  const isCleaningSessionRef = useRef(false);
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();

  // A school tab sends the person here to sign in with code (#6955): the
  // request holds for this tab, and the address forgets it. Declared before
  // the session effect below, which reads it in the same commit.
  useEffect(() => {
    if (searchParams.get(TRAEGER_SIGN_IN_WITH_CODE_PARAM) !== "1") return;
    requestTraegerSignInWithCode();
    const url = new URL(window.location.href);
    url.searchParams.delete(TRAEGER_SIGN_IN_WITH_CODE_PARAM);
    window.history.replaceState(
      {},
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, [searchParams]);

  // An existing Träger session goes straight to the school list; a session
  // the backend no longer refreshes is cleared so a new login is not
  // shadowed by it. A session a sign-in with code is to replace stays until
  // the person ends it with the button below: a page visit alone never
  // signs out (#6955). The request is read from storage here, since the
  // effect above may have set it in this same commit.
  useEffect(() => {
    if (status !== "authenticated") return;
    if (session?.error) {
      void signOutStaleSession({
        status,
        session,
        started: isCleaningSessionRef,
        logger,
      });
      return;
    }
    if (hasSessionAccess(session) && isTraegerSignInWithCodeRequested()) {
      return;
    }
    // The layout's server snapshot carries no token (#4991) and redirects
    // too; a stripped session (empty token) stays on the form.
    if (
      !enrollmentStep &&
      hasSessionAccess(session) &&
      session.user.scope === "org"
    ) {
      window.location.href = traegerPath("/traeger");
    }
  }, [status, session, enrollmentStep]);

  const completeLogin = () => {
    // The sign-in is complete: the next one may use the device again.
    clearTraegerSignInWithCode();
    setAwaitingRedirect(true);
    window.location.href = traegerPath("/traeger");
  };

  const sendLogin = async (
    given: PasswordCredentials,
    organizationId?: string,
  ) => {
    const ignoreTrustedDevice = isTraegerSignInWithCodeRequested();
    const result = await traegerLogin({
      ...given,
      organizationId,
      ...(ignoreTrustedDevice && { ignoreTrustedDevice: true }),
    });
    if (result.status === "organization_selection_required") {
      setChoices(result.organizations);
      setSelectedId(result.organizations[0]?.id ?? null);
      return;
    }
    if (result.status === "mfa_required") {
      setMfaStep(result);
      return;
    }
    if (result.status === "mfa_enrollment_required") {
      setEnrollmentStep({
        enrollmentToken: result.enrollmentToken,
        organizationId: result.organizationId,
      });
      return;
    }
    completeLogin();
  };

  // Ein Konto ohne Zugang zum Träger-Portal kommt als traeger.no_membership.
  const submitCredentials = async (given: PasswordCredentials) => {
    setCredentials(given);
    await sendLogin(given);
  };

  const submitChoice = () =>
    choice.attempt(
      () => sendLogin(credentials, selectedId ?? undefined),
      LOGIN_REFUSALS,
      "die Anmeldung",
      () => latestChoiceRef.current(),
    );

  useLayoutEffect(() => {
    latestChoiceRef.current = () => void submitChoice();
  });

  const backToCredentials = () => {
    choice.errors.clear();
    setChoices(null);
    setSelectedId(null);
    setMfaStep(null);
    setEnrollmentStep(null);
    setCredentials((current) => ({ ...current, password: "" }));
  };

  if (status === "loading") {
    return (
      <AuthShell
        title={SHELL_COPY.title}
        variant="tenant"
        brand={<MotoBrand />}
      >
        <AuthProgress
          state="checking"
          title="Einen Moment bitte"
          description="moto prüft deine Anmeldung."
        />
      </AuthShell>
    );
  }

  // A school asked for a sign-in with code while a Träger session is still
  // open (#6955). Only the person ends it: the button runs the portal's
  // logout (revoke, clear, barrier) and opens this page again without it.
  if (withCode && hasSessionAccess(session) && session.user.scope === "org") {
    const endSession = async () => {
      setEndingSession(true);
      endErrors.clear();
      try {
        await endTraegerSession();
      } catch (err) {
        setEndingSession(false);
        void endErrors.show(err, {
          object: "die Abmeldung",
          retry: () => void endSession(),
        });
      }
    };
    return (
      <AuthShell {...SHELL_COPY} variant="tenant" brand={<MotoBrand />}>
        <div className="space-y-6">
          {endErrors.error ? (
            <FormErrorAlert message={endErrors.error} />
          ) : null}
          <Alert
            type="info"
            message="Die Schule verlangt eine Anmeldung mit Code. Melde dich dafür zuerst ab."
          />
          <Button
            type="button"
            variant="primary"
            size="field"
            className="w-full"
            isLoading={endingSession}
            loadingText="Du wirst abgemeldet …"
            tooltip="Meldet dich ab. Danach meldest du dich mit dem Code aus deiner E-Mail an."
            onClick={() => void endSession()}
          >
            Abmelden und mit Code anmelden
          </Button>
        </div>
      </AuthShell>
    );
  }

  if (mfaStep) {
    return (
      <AuthShell {...SHELL_COPY} variant="tenant" brand={<MotoBrand />}>
        <MFAChallengeForm
          scope="traeger"
          challengeToken={mfaStep.challengeToken}
          maskedEmail={mfaStep.maskedEmail}
          organizationId={mfaStep.organizationId}
          trustedDeviceEnabled={mfaStep.trustedDeviceEnabled}
          trustedDeviceDays={mfaStep.trustedDeviceDays}
          onSuccess={completeLogin}
          onCancel={backToCredentials}
        />
      </AuthShell>
    );
  }

  if (enrollmentStep) {
    return (
      <AuthShell {...SHELL_COPY} variant="tenant" brand={<MotoBrand />}>
        <MFAEnrollmentScreen
          scope="traeger"
          bearerToken={enrollmentStep.enrollmentToken}
          userEmail={credentials.email}
          organizationId={enrollmentStep.organizationId}
          onExit={backToCredentials}
          onComplete={completeLogin}
        />
      </AuthShell>
    );
  }

  const isSubmitting = choice.pending || awaitingRedirect;

  return (
    <AuthShell {...SHELL_COPY} variant="tenant" brand={<MotoBrand />}>
      {choices ? (
        <form
          ref={choice.formRef}
          noValidate
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            void submitChoice();
          }}
        >
          <FormErrorAlert message={choice.errors.error} />
          <fieldset className="space-y-3 border-0 p-0">
            <legend className="mb-2 text-sm font-medium text-gray-700">
              Du gehörst zu mehreren Trägern. Welchen Träger möchtest du öffnen?
            </legend>
            {choices.map((choice) => (
              <ChoiceTile
                key={choice.id}
                tone="green"
                selected={selectedId === choice.id}
                className="p-3"
              >
                <Radio
                  name="organization"
                  value={choice.id}
                  checked={selectedId === choice.id}
                  disabled={isSubmitting}
                  onChange={() => setSelectedId(choice.id)}
                />
                <span>{choice.name}</span>
              </ChoiceTile>
            ))}
          </fieldset>
          <div className="mt-2 space-y-3">
            <Button
              type="submit"
              disabled={isSubmitting || !selectedId}
              variant="primary"
              size="field"
              className="w-full"
            >
              <span className="relative z-10">
                {isSubmitting ? "Anmeldung läuft …" : "Träger öffnen"}
              </span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="field"
              disabled={isSubmitting}
              onClick={backToCredentials}
              className="w-full"
            >
              Mit einem anderen Konto anmelden
            </Button>
          </div>
        </form>
      ) : (
        <PasswordLoginForm
          portal="traeger"
          onSubmit={submitCredentials}
          defaultEmail={credentials.email}
          leaving={awaitingRedirect}
          notice={
            withCode ? (
              <Alert
                type="info"
                message="Die Schule verlangt eine Anmeldung mit Code. Gib nach dem Passwort den Code aus deiner E-Mail ein."
              />
            ) : undefined
          }
        />
      )}
    </AuthShell>
  );
}

export default function TraegerLoginPage() {
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
            description="moto prüft deine Anmeldung."
          />
        </AuthShell>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
