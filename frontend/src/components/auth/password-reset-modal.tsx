"use client";

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Modal } from "~/components/ui/modal";
import { Button } from "~/components/ui/button";
import { FormErrorAlert } from "~/components/ui/form-error-alert";
import { SpinnerIcon } from "~/components/ui/icons";
import { Input } from "~/components/ui/input";
import { useApiFormError } from "~/contexts/ToastContext";
import { ApiError, wireErrorCode } from "~/lib/api-error";
import { requestPasswordReset } from "~/lib/auth-api";
import type { PasswordResetPortal } from "~/lib/portal-paths";
import { looksLikeEmail } from "~/lib/email-format";
import { errorStatus } from "~/lib/expected-failure";
import { createLogger } from "~/lib/logger";

const logger = createLogger({ component: "PasswordReset" });

/**
 * The end of the wait after too many requests. Storage is per origin, and
 * every portal has its own host, so one key serves them all.
 */
const RATE_LIMIT_STORAGE_KEY = "passwordResetRateLimitUntil";

interface PasswordResetModalProps {
  readonly portal: PasswordResetPortal;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly copy?: PasswordResetModalCopy;
  /**
   * The address the login form already holds. Each opening starts with it,
   * so nobody types it twice (#7106).
   */
  readonly initialEmail?: string;
}

export interface PasswordResetModalCopy {
  readonly title: string;
  readonly description: string;
  readonly emailLabel: string;
  /** Shown at the field when the address is empty or not an address. */
  readonly invalidEmail: string;
  readonly cancel: string;
  readonly submit: string;
  readonly submitting: string;
  readonly successTitle: string;
  readonly successMessage: string;
  readonly successHint: string;
  readonly close: string;
  /**
   * `{object}` of the catalog text, feminine or neuter with article ("das
   * Senden des Links"), and the wait shown next to the button after too
   * many requests.
   */
  readonly errorObject: string;
  readonly rateLimitWait: (countdown: string) => string;
}

export const DEFAULT_PASSWORD_RESET_MODAL_COPY: PasswordResetModalCopy = {
  title: "Passwort zurücksetzen",
  description:
    "Geben Sie Ihre E-Mail-Adresse ein und wir senden Ihnen einen Link zum Zurücksetzen Ihres Passworts.",
  emailLabel: "E-Mail-Adresse",
  invalidEmail: "Bitte geben Sie eine gültige E-Mail-Adresse ein.",
  cancel: "Abbrechen",
  submit: "Link senden",
  submitting: "Wird gesendet...",
  successTitle: "E-Mail versendet!",
  successMessage:
    "Wir haben Ihnen eine E-Mail mit einem Link zum Zurücksetzen Ihres Passworts gesendet.",
  successHint:
    "Bitte überprüfen Sie Ihren Posteingang und folgen Sie den Anweisungen in der E-Mail.",
  close: "Schließen",
  errorObject: "das Senden des Links",
  rateLimitWait: (countdown) =>
    `Einen neuen Link können Sie in ${countdown} anfordern.`,
};

const EmailIcon = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="48"
    height="48"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  </svg>
);

const SuccessCheckIcon = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="48"
    height="48"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

const formatCountdown = (totalSeconds: number): string => {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
};

export function PasswordResetModal({
  portal,
  isOpen,
  onClose,
  copy = DEFAULT_PASSWORD_RESET_MODAL_COPY,
  initialEmail = "",
}: PasswordResetModalProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const errorPath = useApiFormError(formRef);
  const [email, setEmail] = useState(isOpen ? initialEmail.trim() : "");
  // The dialog stays mounted while closed: each opening takes the login
  // form's address anew.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) setEmail(initialEmail.trim());
  }
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [rateLimitUntil, setRateLimitUntil] = useState<number | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const latestSubmitRef = useRef<() => void>(() => undefined);
  const clearPathError = errorPath.clear;

  useEffect(() => {
    const stored = globalThis.localStorage.getItem(RATE_LIMIT_STORAGE_KEY);
    if (!stored) return;

    const timestamp = Number(stored);
    if (!Number.isNaN(timestamp) && timestamp > Date.now()) {
      setRateLimitUntil(timestamp);
    } else if (!Number.isNaN(timestamp)) {
      globalThis.localStorage.removeItem(RATE_LIMIT_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (!rateLimitUntil) {
      setSecondsRemaining(0);
      return;
    }

    const updateCountdown = () => {
      const now = Date.now();
      if (rateLimitUntil <= now) {
        setRateLimitUntil(null);
        setSecondsRemaining(0);
        globalThis.localStorage.removeItem(RATE_LIMIT_STORAGE_KEY);
        clearPathError();
      } else {
        // The catalog text stays in the alert; the countdown runs next to
        // the button.
        setSecondsRemaining(Math.ceil((rateLimitUntil - now) / 1000));
      }
    };

    updateCountdown();
    const intervalId = globalThis.setInterval(updateCountdown, 1000);
    return () => globalThis.clearInterval(intervalId);
  }, [rateLimitUntil, clearPathError]);

  const rateLimitActive =
    rateLimitUntil !== null && rateLimitUntil > Date.now();

  const handleClose = useCallback(() => {
    clearPathError();
    setIsSuccess(false);
    setIsLoading(false);
    onClose();
  }, [onClose, clearPathError]);

  const startRateLimit = (retryAfterSeconds: number | undefined) => {
    const retrySeconds =
      retryAfterSeconds && retryAfterSeconds > 0 ? retryAfterSeconds : 3600;
    const retryUntil = Date.now() + retrySeconds * 1000;
    setRateLimitUntil(retryUntil);
    setSecondsRemaining(retrySeconds);
    // This is a numeric rate-limit expiry, not an authentication token.
    globalThis.localStorage.setItem(
      RATE_LIMIT_STORAGE_KEY,
      retryUntil.toString(),
    );
  };

  const errorObject = copy.errorObject;

  const submit = async () => {
    const path = errorPath;
    path.clear();
    const address = email.trim();
    if (!looksLikeEmail(address)) {
      path.invalid(copy.invalidEmail, { email: copy.invalidEmail });
      return;
    }
    setIsLoading(true);
    try {
      await requestPasswordReset(portal, address);
      setIsSuccess(true);
    } catch (err) {
      if (
        err instanceof ApiError &&
        wireErrorCode(err.code) === "identity.password_reset_rate_limited"
      ) {
        logger.warn("password_reset_rate_limited", {
          error: "rate_limit_exceeded",
        });
        startRateLimit(err.retryAfterSeconds);
        void path.show(err, { object: errorObject });
      } else {
        const status = errorStatus(err);
        const failure = {
          error: err instanceof Error ? err.message : String(err),
          status,
        };
        // A refused address is no defect.
        if (status !== undefined && status >= 400 && status < 500) {
          logger.warn("password_reset_failed", failure);
        } else {
          logger.error("password_reset_failed", failure);
        }
        void path.show(err, {
          object: errorObject,
          retry: () => latestSubmitRef.current(),
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  // „Wiederholen“ sendet die Adresse, die dann im Feld steht.
  useLayoutEffect(() => {
    latestSubmitRef.current = () => {
      void submit();
    };
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // The button is disabled while the wait runs.
    if (!rateLimitActive) await submit();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title=""
      ariaLabel={isSuccess ? copy.successTitle : copy.title}
      footer={undefined}
    >
      <div className="text-center">
        {isSuccess ? (
          <>
            <SuccessCheckIcon className="text-moto-green-strong mx-auto mb-4 h-12 w-12" />
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-gray-800 sm:text-4xl">
              {copy.successTitle}
            </h1>
            <p className="mt-4 text-gray-600">{copy.successMessage}</p>
            <p className="mt-2 text-sm text-gray-500">{copy.successHint}</p>
            <div className="mt-6">
              <Button type="button" size="md" onClick={handleClose}>
                {copy.close}
              </Button>
            </div>
          </>
        ) : (
          <>
            <EmailIcon className="mx-auto mb-4 h-12 w-12 text-gray-700" />
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-gray-800 sm:text-4xl">
              {copy.title}
            </h1>
            <p className="mt-4 text-gray-600">{copy.description}</p>

            <form
              ref={formRef}
              onSubmit={handleSubmit}
              noValidate
              className="mt-6 space-y-4"
            >
              <FormErrorAlert message={errorPath.error} />
              {rateLimitActive ? (
                <p className="text-sm text-gray-600" role="status">
                  {copy.rateLimitWait(
                    formatCountdown(Math.max(secondsRemaining, 0)),
                  )}
                </p>
              ) : null}

              <div className="text-left">
                <Input
                  controlSize="touch"
                  id="reset-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full"
                  label={copy.emailLabel}
                  disabled={isLoading}
                  error={errorPath.fieldError("email")}
                />
              </div>

              <div className="flex justify-center gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  onClick={handleClose}
                  disabled={isLoading}
                >
                  {copy.cancel}
                </Button>
                <Button
                  type="submit"
                  size="md"
                  disabled={isLoading || rateLimitActive}
                >
                  {isLoading ? (
                    <>
                      <SpinnerIcon className="mr-2 -ml-1 h-4 w-4" />
                      <span>{copy.submitting}</span>
                    </>
                  ) : (
                    <span>{copy.submit}</span>
                  )}
                </Button>
              </div>
            </form>
          </>
        )}
      </div>
    </Modal>
  );
}
