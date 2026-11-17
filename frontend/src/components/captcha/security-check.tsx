"use client";

import { ArrowClockwiseIcon, CheckIcon, LinkIcon } from "@phosphor-icons/react";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useEffect, useState, type ReactNode, type Ref } from "react";

import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { createLogger } from "~/lib/logger";
import { useClipboardCopy } from "~/lib/use-clipboard-copy";

const SCRIPT_ID = "moto-security-check-script";

/** How long the check may take to show before the form calls it failed. */
export const SECURITY_CHECK_LOAD_TIMEOUT_MS = 15_000;

const logger = createLogger({ component: "SecurityCheck" });

type FailureReason = "script" | "widget" | "unsupported" | "timeout";

export interface SecurityCheckCopy {
  /** One line under the check: what to do when it hangs. */
  readonly hint: string;
  /** Label of the button that starts the check again. */
  readonly restart: string;
  /** What the restart button does. */
  readonly restartTooltip: string;
  /** Title of the notice when the check cannot load on this device. */
  readonly failedTitle: string;
  /** The usual cause, leading into the steps. */
  readonly failedText: string;
  /** Step 1: switch the ad blocker off for this page. */
  readonly failedStepBlocker: string;
  /** Step 2: restart the check. */
  readonly failedStepRestart: string;
  /** Step 3: open the copied link in another browser. */
  readonly failedStepBrowser: string;
  /** Label of the button that copies the page address. */
  readonly copyLink: string;
  /** What the copy button does. */
  readonly copyLinkTooltip: string;
  /** Label of the copy button once the address is copied. */
  readonly linkCopied: string;
  /** Shown above the address when the device does not allow copying. */
  readonly copyFailed: string;
}

const SECURITY_CHECK_COPY_KEYS = [
  "hint",
  "restart",
  "restartTooltip",
  "failedTitle",
  "failedText",
  "failedStepBlocker",
  "failedStepRestart",
  "failedStepBrowser",
  "copyLink",
  "copyLinkTooltip",
  "linkCopied",
  "copyFailed",
] as const satisfies readonly (keyof SecurityCheckCopy)[];

/** Reads every text of the check from a form's `captchaHelp` messages. */
export function securityCheckCopy(
  translate: (key: keyof SecurityCheckCopy) => string,
): SecurityCheckCopy {
  return Object.fromEntries(
    SECURITY_CHECK_COPY_KEYS.map((key) => [key, translate(key)]),
  ) as unknown as SecurityCheckCopy;
}

/**
 * The Turnstile check of the public forms, with a way out when it hangs
 * (#7114, WCAG 3.3.8): a line says what to do and a button loads the check
 * again. The form keeps its entries; only the check starts over.
 *
 * Until Cloudflare shows the widget, a placeholder of its size holds the
 * place. When the check cannot load at all, the form says so: an ad blocker
 * or a DNS filter that blocks Cloudflare left an empty space and a locked
 * send button before. The script error, a widget error, an unsupported
 * browser or a widget that has not shown after a timeout count as failed;
 * the notice then names the steps and copies the link for another browser.
 */
export function SecurityCheck({
  siteKey,
  copy,
  token,
  onToken,
  instanceRef,
}: Readonly<{
  siteKey: string;
  copy: SecurityCheckCopy;
  /** The form's current token, also cleared after a failed submit. */
  token: string;
  /** The solved token, or "" when it expired, failed or restarted. */
  onToken: (token: string) => void;
  /** The widget, for a reset by the form after a failed submit. */
  instanceRef?: Ref<TurnstileInstance | undefined>;
}>) {
  // A new key mounts a fresh widget. `reset()` does not help a widget that
  // never finished loading.
  const [attempt, setAttempt] = useState(0);
  // Both name the attempt they belong to, so a restart clears them.
  const [shownAttempt, setShownAttempt] = useState(-1);
  const [failedAttempt, setFailedAttempt] = useState(-1);
  const failed = failedAttempt === attempt;
  const shown = shownAttempt === attempt;

  const fail = (reason: FailureReason) => {
    onToken("");
    if (failedAttempt === attempt) return;
    setFailedAttempt(attempt);
    logger.warn("security_check_failed", { reason, attempt });
  };

  // No callback fires when a blocker swallows the request without an error.
  useEffect(() => {
    if (shown || failed) return;
    const timer = window.setTimeout(() => {
      setFailedAttempt(attempt);
      logger.warn("security_check_failed", { reason: "timeout", attempt });
    }, SECURITY_CHECK_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [attempt, shown, failed]);

  const restart = (
    <Button
      type="button"
      variant="outline"
      size="compact"
      tooltip={copy.restartTooltip}
      onClick={() => {
        // The library keeps a failed/pending script in the DOM and
        // skips injection on remount. Keep a successfully loaded API.
        if (!window.turnstile) {
          document.getElementById(SCRIPT_ID)?.remove();
        }
        onToken("");
        setAttempt((current) => current + 1);
      }}
    >
      <ArrowClockwiseIcon className="size-4" aria-hidden="true" />
      {copy.restart}
    </Button>
  );

  return (
    // basis-full: in a wrapping row beside the send button, the notice takes
    // its own line instead of squeezing the text next to the buttons.
    <div
      className={`min-w-0 flex-1 space-y-2 ${failed && !token ? "basis-full" : ""}`}
    >
      {/* Turnstile draws its 300 × 65 px widget into this box. The placeholder
          holds the place until then, so nothing jumps when it appears. */}
      <div className={failed && !shown ? "hidden" : "relative w-fit"}>
        {shown ? null : (
          <Skeleton
            shape="control"
            className="absolute inset-0"
            aria-hidden="true"
          />
        )}
        <div className="relative min-h-[65px] min-w-[300px]">
          <Turnstile
            key={attempt}
            ref={instanceRef}
            siteKey={siteKey}
            scriptOptions={{ id: SCRIPT_ID, onError: () => fail("script") }}
            options={{ theme: "light" }}
            onWidgetLoad={() => setShownAttempt(attempt)}
            onSuccess={(value) => {
              setFailedAttempt(-1);
              onToken(value);
            }}
            onExpire={() => onToken("")}
            onError={() => fail("widget")}
            onUnsupported={() => fail("unsupported")}
          />
        </div>
      </div>
      {token ? null : failed ? (
        <SecurityCheckFailed copy={copy} restart={restart} />
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="text-sm text-gray-600">{copy.hint}</p>
          {restart}
        </div>
      )}
    </div>
  );
}

/** The notice of a check that cannot load: cause, three steps, two actions. */
function SecurityCheckFailed({
  copy,
  restart,
}: Readonly<{ copy: SecurityCheckCopy; restart: ReactNode }>) {
  const { copied, copy: copyText } = useClipboardCopy("SecurityCheck", 3000);
  const [manualLink, setManualLink] = useState("");

  return (
    <Alert
      type="warning"
      announce="polite"
      title={copy.failedTitle}
      message={copy.failedText}
      details={
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>{copy.failedStepBlocker}</li>
          <li>{copy.failedStepRestart}</li>
          <li>{copy.failedStepBrowser}</li>
        </ol>
      }
      actionLayout="stacked"
      action={
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {restart}
            <Button
              type="button"
              variant="outline"
              size="compact"
              tooltip={copy.copyLinkTooltip}
              onClick={async () => {
                const link = window.location.href;
                setManualLink((await copyText(link)) ? "" : link);
              }}
            >
              {copied ? (
                <CheckIcon className="size-4" aria-hidden="true" />
              ) : (
                <LinkIcon className="size-4" aria-hidden="true" />
              )}
              <span aria-live="polite">
                {copied ? copy.linkCopied : copy.copyLink}
              </span>
            </Button>
          </div>
          {manualLink ? (
            <p>
              {copy.copyFailed}{" "}
              <span className="font-medium break-all select-all">
                {manualLink}
              </span>
            </p>
          ) : null}
        </div>
      }
    />
  );
}
