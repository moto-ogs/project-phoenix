"use client";

import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  EnvelopeSimpleIcon,
  HourglassMediumIcon,
  PaperPlaneTiltIcon,
} from "@phosphor-icons/react";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { FormErrorAlert } from "~/components/ui/form-error-alert";
import { IconTile } from "~/components/ui/icon-tile";
import { Input } from "~/components/ui/input";
import { InsetPanel } from "~/components/ui/inset-panel";
import { Modal } from "~/components/ui/modal";
import { ModalCancelButton } from "~/components/ui/modal-frame";
import { useApiFormError } from "~/contexts/ToastContext";
import { ApiError, wireErrorCode } from "~/lib/api-error";
import { requestPasswordReset } from "~/lib/auth-api";
import type { PasswordResetPortal } from "~/lib/portal-paths";
import { looksLikeEmail } from "~/lib/email-format";
import { errorStatus } from "~/lib/expected-failure";
import { createLogger } from "~/lib/logger";
import {
  normalizeResetAddress,
  readResetWaits,
  rememberResetWait,
  resetWaitUntil,
} from "./password-reset-wait";

const logger = createLogger({ component: "PasswordReset" });

/** The backend's window, for a refusal that names no Retry-After. */
const FALLBACK_WAIT_SECONDS = 3600;

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
  /**
   * Says the link comes only if the address has an account: the answer is
   * the same for every address (#7213), so the dialog never claims a mail.
   */
  readonly successMessage: string;
  readonly successHint: string;
  /** Back to the form with the address, to correct a typo. */
  readonly changeAddress: string;
  readonly close: string;
  /**
   * `{object}` of the catalog text, feminine or neuter with article ("das
   * Senden des Links").
   */
  readonly errorObject: string;
  /** The wait for this address after too many requests, `mm:ss`. */
  readonly rateLimitWait: (countdown: string) => string;
}

export const DEFAULT_PASSWORD_RESET_MODAL_COPY: PasswordResetModalCopy = {
  title: "Passwort zurücksetzen",
  description:
    "Wir schicken Ihnen einen Link. Damit legen Sie ein neues Passwort fest.",
  emailLabel: "E-Mail-Adresse",
  invalidEmail: "Bitte geben Sie eine gültige E-Mail-Adresse ein.",
  cancel: "Abbrechen",
  submit: "Link senden",
  submitting: "Wird gesendet …",
  successTitle: "Bitte prüfen Sie Ihr Postfach",
  successMessage:
    "Wenn es zu dieser Adresse ein Konto gibt, bekommen Sie gleich eine E-Mail mit dem Link.",
  successHint:
    "Keine E-Mail da? Sehen Sie auch im Spam-Ordner nach. Stimmt die Adresse nicht, ändern Sie sie.",
  changeAddress: "Adresse ändern",
  close: "Schließen",
  errorObject: "das Senden des Links",
  rateLimitWait: (countdown) =>
    `Für diese Adresse wurde schon mehrmals ein Link angefordert. Einen neuen Link können Sie in ${countdown} anfordern.`,
};

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
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
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
  // The address the link went to; set, the dialog shows the answer.
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [waits, setWaits] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => Date.now());
  // Read once when the wait starts; the ticking warning stays silent.
  const [waitAnnouncement, setWaitAnnouncement] = useState("");
  const latestSubmitRef = useRef<() => void>(() => undefined);
  const clearPathError = errorPath.clear;

  // Storage is read after mount: the login pages render on the server too.
  useEffect(() => {
    setWaits(readResetWaits(Date.now()));
  }, []);

  const waitUntil = resetWaitUntil(waits, email, now);
  const waitText =
    waitUntil === null
      ? null
      : copy.rateLimitWait(
          formatCountdown(Math.max(1, Math.ceil((waitUntil - now) / 1000))),
        );

  useEffect(() => {
    if (waitUntil === null) return;
    const intervalId = globalThis.setInterval(() => setNow(Date.now()), 1000);
    return () => globalThis.clearInterval(intervalId);
  }, [waitUntil]);

  const handleClose = () => {
    clearPathError();
    setSentTo(null);
    setIsLoading(false);
    onClose();
  };

  const startWait = (
    address: string,
    retryAfterSeconds: number | undefined,
  ) => {
    const current = Date.now();
    const seconds =
      retryAfterSeconds && retryAfterSeconds > 0
        ? retryAfterSeconds
        : FALLBACK_WAIT_SECONDS;
    setNow(current);
    setWaitAnnouncement(copy.rateLimitWait(formatCountdown(seconds)));
    setWaits((previous) =>
      rememberResetWait(previous, address, current + seconds * 1000, current),
    );
  };

  const submit = async () => {
    const path = errorPath;
    path.clear();
    setWaitAnnouncement("");
    const address = email.trim();
    if (!looksLikeEmail(address)) {
      path.invalid(copy.invalidEmail, { email: copy.invalidEmail });
      return;
    }
    setIsLoading(true);
    try {
      await requestPasswordReset(portal, address);
      setSentTo(address);
    } catch (err) {
      if (
        err instanceof ApiError &&
        wireErrorCode(err.code) === "identity.password_reset_rate_limited"
      ) {
        logger.warn("password_reset_rate_limited", {
          error: "rate_limit_exceeded",
        });
        // No failure of the dialog: the address waits, and the warning
        // under the field says how long (#7213).
        startWait(address, err.retryAfterSeconds);
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
          object: copy.errorObject,
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
    // The button is disabled while the address waits.
    if (waitUntil === null) await submit();
  };

  const changeAddress = () => {
    setSentTo(null);
    // The form mounts with this render; focus the field once it is there.
    globalThis.requestAnimationFrame(() => emailRef.current?.select());
  };

  if (sentTo !== null) {
    return (
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        title={copy.successTitle}
        titleLevel={2}
        icon={
          <IconTile
            size="section"
            tone="green"
            icon={<PaperPlaneTiltIcon weight="duotone" aria-hidden />}
          />
        }
        size="sm"
        mobileSheet
        sheetFooter="row"
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={changeAddress}
            >
              {copy.changeAddress}
            </Button>
            <Button type="button" size="md" onClick={handleClose}>
              {copy.close}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-700">{copy.successMessage}</p>
          <InsetPanel framed padding="sm" className="flex items-center gap-3">
            <EnvelopeSimpleIcon
              className="size-5 shrink-0 text-gray-500"
              aria-hidden
            />
            <span className="min-w-0 text-sm font-medium break-all text-gray-900">
              {normalizeResetAddress(sentTo)}
            </span>
          </InsetPanel>
          <p className="text-sm text-gray-500">{copy.successHint}</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={copy.title}
      titleLevel={2}
      description={copy.description}
      icon={
        <IconTile
          size="section"
          tone="neutral"
          icon={<EnvelopeSimpleIcon aria-hidden />}
        />
      }
      size="sm"
      mobileSheet
      sheetFooter="row"
      initialFocusRef={emailRef}
      busy={isLoading}
      footer={
        <>
          <ModalCancelButton onClick={handleClose} disabled={isLoading}>
            {copy.cancel}
          </ModalCancelButton>
          <Button
            type="submit"
            form={formId}
            size="md"
            isLoading={isLoading}
            loadingText={copy.submitting}
            disabled={waitText !== null}
            disabledReason={waitText ?? undefined}
          >
            {copy.submit}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        ref={formRef}
        onSubmit={handleSubmit}
        noValidate
        className="space-y-4"
      >
        <FormErrorAlert message={errorPath.error} />
        <Input
          ref={emailRef}
          controlSize="touch"
          id="reset-email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          spellCheck={false}
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            // A wait that ran out while no countdown ticked ends here.
            setNow(Date.now());
            // The announcement belonged to the address just replaced.
            setWaitAnnouncement("");
          }}
          className="w-full"
          label={copy.emailLabel}
          disabled={isLoading}
          error={errorPath.fieldError("email")}
        />
        {waitText === null ? null : (
          <Alert
            type="warning"
            // The countdown changes every second; a live region would read
            // it out every second. The status below announces it once.
            announce="off"
            icon={<HourglassMediumIcon weight="duotone" aria-hidden />}
            message={<span className="tabular-nums">{waitText}</span>}
          />
        )}
        <p className="sr-only" role="status">
          {waitAnnouncement}
        </p>
      </form>
    </Modal>
  );
}
