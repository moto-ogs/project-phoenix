"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  credentialError,
  LOGIN_CREDENTIAL_FIELDS,
  INVALID_CREDENTIALS,
  LOGIN_REFUSALS,
  PASSKEY_LOGIN_REFUSALS,
} from "~/components/auth/credential-error";
import {
  DEFAULT_PASSWORD_RESET_MODAL_COPY,
  PasswordResetModal,
  type PasswordResetModalCopy,
} from "~/components/auth/password-reset-modal";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { FieldErrorHint } from "~/components/ui/field-error-hint";
import { FieldLabel } from "~/components/ui/field-label";
import { FormErrorAlert } from "~/components/ui/form-error-alert";
import { Input } from "~/components/ui/input";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import { useApiFormError } from "~/contexts/ToastContext";
import { ApiError, unavailableApiError } from "~/lib/api-error";
import { passkeysConcept } from "~/lib/concepts/passkeys";
import type { ErrorCode } from "~/lib/error-codes.generated";
import { errorStatus } from "~/lib/expected-failure";
import { FORGOT_PASSWORD_PARAM } from "~/lib/login-params";
import {
  useLogoutNotRevokedNotice,
  usePasswordChangedNotice,
  useSessionExpiredNotice,
} from "~/lib/login-session-notice";
import { createLogger } from "~/lib/logger";
import { LOGOUT_NOT_REVOKED_NOTICE } from "~/lib/logout-notice.generated";
import {
  isPasskeyCeremonyIncompleteError,
  isPasskeySupported,
} from "~/lib/passkey-api";
import { hasPasswordReset, type PortalKey } from "~/lib/portal-paths";

const logger = createLogger({ component: "PasswordLoginForm" });

export interface PasswordCredentials {
  readonly email: string;
  readonly password: string;
}

export interface PasswordLoginCopy {
  readonly emailLabel: string;
  readonly passwordLabel: string;
  readonly showPassword?: string;
  readonly hidePassword?: string;
  readonly forgotPassword: string;
  readonly submit: string;
  readonly submitting: string;
  /** `{object}` of the catalog text of a refused login. */
  readonly errorObject: string;
  /** Only for a portal with passkeys. */
  readonly passkey?: string;
  readonly passkeyErrorObject?: string;
  readonly missingEmail: string;
  readonly missingPassword: string;
  readonly missingCredentials: string;
  /**
   * Every portal login shares the backend's limiter, whose 429 carries only
   * the class code: that text would ask to try again at once.
   */
  readonly rateLimited: string;
  readonly sessionExpired: string;
  /** The catalog text for a logout that ended this device's session only. */
  readonly logoutNotRevoked: string;
  /** The person changed their password, which signed them out. */
  readonly passwordChanged?: string;
  readonly reset?: PasswordResetModalCopy;
}

const DEFAULT_COPY = {
  emailLabel: "E-Mail-Adresse",
  passwordLabel: "Passwort",
  forgotPassword: "Passwort vergessen?",
  submit: "Anmelden",
  submitting: "Anmeldung läuft …",
  passkey: "Mit Passkey anmelden",
  errorObject: "die Anmeldung",
  passkeyErrorObject: "die Anmeldung mit Passkey",
  missingEmail: "Bitte gib deine E-Mail-Adresse ein.",
  missingPassword: "Bitte gib dein Passwort ein.",
  missingCredentials: "Bitte gib E-Mail-Adresse und Passwort ein.",
  rateLimited: "Zu viele Anmeldeversuche. Bitte versuche es später erneut.",
  sessionExpired: "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.",
  logoutNotRevoked: LOGOUT_NOT_REVOKED_NOTICE,
  passwordChanged:
    "Dein Passwort ist geändert. Melde dich jetzt mit dem neuen Passwort an.",
} as const satisfies PasswordLoginCopy &
  Required<Pick<PasswordLoginCopy, "passkey" | "passkeyErrorObject">>;

interface PasswordLoginFormProps {
  readonly portal: PortalKey;
  /**
   * Signs in. Resolves when the page took over (next step, redirect, or a
   * hint of its own in `refusal`); a rejection is shown by the form.
   */
  readonly onSubmit: (credentials: PasswordCredentials) => Promise<void>;
  /** The portal's passkey sign-in; without it the form offers none. */
  readonly onPasskey?: () => Promise<void>;
  /** The address of the last attempt, for a return from a later step. */
  readonly defaultEmail?: string;
  /** The page is settling its session: nothing can be sent yet. */
  readonly locked?: boolean;
  /** The sign-in succeeded and the page is opening the portal. */
  readonly leaving?: boolean;
  /** The page's own answer to the last attempt, in place of an error. */
  readonly refusal?: ReactNode;
  /** A standing hint, shown while no attempt failed. */
  readonly notice?: ReactNode;
  readonly copy?: PasswordLoginCopy;
}

/**
 * One sign-in attempt of a login step on the shared error path: a refusal
 * shows its catalog text, the limiter's 429 says to wait, a failure without
 * an answer reads as unreachable, and a 4xx stays out of the error reports.
 */
export function useLoginAttempt(
  portal: PortalKey,
  rateLimited: string = DEFAULT_COPY.rateLimited,
) {
  const formRef = useRef<HTMLFormElement>(null);
  const errors = useApiFormError(formRef, { preloadPresenter: false });
  const [pending, setPending] = useState(false);
  const [passwordRefused, setPasswordRefused] = useState(false);

  const attempt = async (
    run: () => Promise<void>,
    refusals: readonly ErrorCode[],
    object: string,
    retry: () => void,
  ) => {
    setPending(true);
    errors.clear();
    setPasswordRefused(false);
    try {
      await run();
    } catch (err) {
      if (isPasskeyCeremonyIncompleteError(err)) {
        // The person closed the browser dialog: nothing to report.
        logger.info("passkey_login_not_completed", { portal });
        return;
      }
      const status = errorStatus(err);
      const failure = {
        portal,
        error: err instanceof Error ? err.message : String(err),
        status,
      };
      if (status !== undefined && status >= 400 && status < 500) {
        logger.warn("login_rejected", failure);
      } else {
        logger.error("login_failed", failure);
      }
      // A 429 with a code of its own (a blocked second factor) keeps its
      // catalog text.
      if (
        status === 429 &&
        (!(err instanceof ApiError) ||
          err.code === undefined ||
          err.code === "general.unavailable")
      ) {
        errors.invalid(rateLimited);
        return;
      }
      setPasswordRefused(
        status === 401 &&
          err instanceof ApiError &&
          err.code !== undefined &&
          (INVALID_CREDENTIALS as readonly ErrorCode[]).includes(err.code),
      );
      void errors.show(
        err instanceof ApiError
          ? credentialError(err, refusals, LOGIN_CREDENTIAL_FIELDS)
          : unavailableApiError(err),
        { object, retry },
      );
    } finally {
      setPending(false);
    }
  };

  return { formRef, errors, pending, passwordRefused, attempt };
}

/**
 * The e-mail and password step of every portal login: fields, the shared
 * error path with „Wiederholen“, the passkey button and „Passwort
 * vergessen?“ with the typed address.
 */
export function PasswordLoginForm({
  portal,
  onSubmit,
  onPasskey,
  defaultEmail = "",
  locked = false,
  leaving = false,
  refusal,
  notice,
  copy = DEFAULT_COPY,
}: PasswordLoginFormProps) {
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState("");
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [isResetOpen, setIsResetOpen] = useState(false);
  const [sessionExpired, setSessionExpired] = useSessionExpiredNotice();
  const [logoutNotRevoked, setLogoutNotRevoked] = useLogoutNotRevokedNotice();
  const [passwordChanged, setPasswordChanged] = usePasswordChangedNotice();
  const { formRef, errors, pending, passwordRefused, attempt } =
    useLoginAttempt(portal, copy.rateLimited);
  const latestSubmitRef = useRef<() => void>(() => undefined);
  const latestPasskeyRef = useRef<() => void>(() => undefined);
  const resetPortal = hasPasswordReset(portal) ? portal : null;
  const sending = pending || leaving;
  const busy = locked || sending;

  const offersPasskey = onPasskey !== undefined;
  useEffect(() => {
    if (offersPasskey) setPasskeySupported(isPasskeySupported());
  }, [offersPasskey]);

  // A reset link without token leads here to ask for a new link: the dialog
  // opens at once, and the address forgets the request.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get(FORGOT_PASSWORD_PARAM) !== "1") return;
    url.searchParams.delete(FORGOT_PASSWORD_PARAM);
    window.history.replaceState(
      {},
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    if (resetPortal) setIsResetOpen(true);
  }, [resetPortal]);

  const submit = async () => {
    if (busy) return;
    // An empty field is named before anything is sent: the refusal's
    // „prüfen Sie Ihre Eingabe“ would not say what is missing.
    const missing: Record<string, string> = {};
    if (email.trim() === "") missing.email = copy.missingEmail;
    if (password === "") missing.password = copy.missingPassword;
    const texts = Object.values(missing);
    if (texts.length > 0) {
      errors.invalid(
        texts.length > 1 ? copy.missingCredentials : (texts[0] ?? ""),
        missing,
      );
      return;
    }
    setSessionExpired(false);
    setLogoutNotRevoked(false);
    setPasswordChanged(false);
    await attempt(
      () => onSubmit({ email, password }),
      LOGIN_REFUSALS,
      copy.errorObject,
      () => latestSubmitRef.current(),
    );
  };

  const passkeyLogin = async () => {
    if (busy || !onPasskey) return;
    setSessionExpired(false);
    setLogoutNotRevoked(false);
    setPasswordChanged(false);
    await attempt(
      onPasskey,
      PASSKEY_LOGIN_REFUSALS,
      copy.passkeyErrorObject ?? DEFAULT_COPY.passkeyErrorObject,
      () => latestPasskeyRef.current(),
    );
  };

  // „Wiederholen“ sendet den Stand, der dann im Formular steht.
  useLayoutEffect(() => {
    latestSubmitRef.current = () => void submit();
    latestPasskeyRef.current = () => void passkeyLogin();
  });

  const emailError = errors.fieldError("email");
  const passwordError = errors.fieldError("password");
  const failed = Boolean(refusal) || Boolean(errors.error);

  return (
    <>
      <form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        noValidate
        className="space-y-6"
        aria-busy={locked || undefined}
      >
        {/* The form's own error is the newer answer: a page's refusal of
            an earlier attempt gives way to it. */}
        {refusal && !errors.error ? (
          refusal
        ) : (
          <FormErrorAlert
            message={errors.error}
            action={
              passwordRefused && resetPortal ? (
                <Button
                  type="button"
                  variant="link_tone"
                  size="compact"
                  onClick={() => setIsResetOpen(true)}
                  className="-ml-2.5 self-start"
                >
                  {(copy.reset ?? DEFAULT_PASSWORD_RESET_MODAL_COPY).title}
                </Button>
              ) : undefined
            }
          />
        )}
        {failed ? null : notice}
        {!failed && logoutNotRevoked ? (
          <Alert
            type="warning"
            message={copy.logoutNotRevoked}
            data-testid="logout-not-revoked-notice"
          />
        ) : null}
        {!failed && passwordChanged ? (
          <Alert
            type="success"
            message={copy.passwordChanged ?? DEFAULT_COPY.passwordChanged}
            data-testid="password-changed-notice"
          />
        ) : null}
        {!failed && sessionExpired && !passwordChanged ? (
          <Alert type="info" message={copy.sessionExpired} />
        ) : null}

        <div className="space-y-4">
          <div className="text-left">
            <Input
              id="email"
              name="email"
              type="email"
              label={copy.emailLabel}
              controlSize="touch"
              data-testid="input-email"
              autoComplete="username"
              required
              disabled={busy}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              error={emailError}
            />
          </div>

          <div className="text-left">
            <FieldLabel
              htmlFor="password"
              required
              invalid={Boolean(passwordError)}
            >
              {copy.passwordLabel}
            </FieldLabel>
            <Input
              id="password"
              name="password"
              type="password"
              controlSize="touch"
              data-testid="input-password"
              autoComplete="current-password"
              required
              disabled={busy}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={Boolean(passwordError)}
              aria-describedby={passwordError ? "password-error" : undefined}
              revealable
              showPasswordLabel={copy.showPassword}
              hidePasswordLabel={copy.hidePassword}
            />
            <FieldErrorHint id="password-error" message={passwordError} />
          </div>

          {resetPortal ? (
            <div className="text-center">
              <Button
                type="button"
                disabled={busy}
                onClick={() => setIsResetOpen(true)}
                variant="link"
                size="md"
              >
                {copy.forgotPassword}
              </Button>
            </div>
          ) : null}
        </div>

        <Button
          type="submit"
          disabled={busy}
          variant="primary"
          size="field"
          className="w-full"
        >
          <span className="relative z-10">
            {sending ? copy.submitting : copy.submit}
          </span>
        </Button>
        {onPasskey && passkeySupported ? (
          <Button
            type="button"
            variant="outline"
            size="field"
            className="w-full gap-2"
            disabled={busy}
            onClick={() => void passkeyLogin()}
          >
            <MotoConceptIcon concept={passkeysConcept} size={16} />
            <span>{copy.passkey ?? DEFAULT_COPY.passkey}</span>
          </Button>
        ) : null}
      </form>

      {/* Outside the login form: React carries a portal's submit event up
          its component tree. */}
      {resetPortal ? (
        <PasswordResetModal
          portal={resetPortal}
          isOpen={isResetOpen}
          onClose={() => setIsResetOpen(false)}
          initialEmail={email}
          copy={copy.reset}
        />
      ) : null}
    </>
  );
}
