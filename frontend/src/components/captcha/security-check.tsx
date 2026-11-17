"use client";

import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useEffect, useState, type Ref } from "react";

import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { createLogger } from "~/lib/logger";

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
  /** What the person can do about it: ad blocker, other browser. */
  readonly failedText: string;
}

/**
 * The Turnstile check of the public forms, with a way out when it hangs
 * (#7114, WCAG 3.3.8): a line says what to do and a button loads the check
 * again. The form keeps its entries; only the check starts over.
 *
 * When the check cannot load at all, the form says so: an ad blocker or a
 * DNS filter that blocks Cloudflare leaves an empty space and a locked
 * send button otherwise. The script error, a widget error, an unsupported
 * browser or a widget that has not shown after a timeout count as failed.
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

  const fail = (reason: FailureReason) => {
    onToken("");
    if (failedAttempt === attempt) return;
    setFailedAttempt(attempt);
    logger.warn("security_check_failed", { reason, attempt });
  };

  // No callback fires when a blocker swallows the request without an error.
  useEffect(() => {
    if (shownAttempt === attempt || failedAttempt === attempt) return;
    const timer = window.setTimeout(() => {
      setFailedAttempt(attempt);
      logger.warn("security_check_failed", { reason: "timeout", attempt });
    }, SECURITY_CHECK_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [attempt, shownAttempt, failedAttempt]);

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
      {copy.restart}
    </Button>
  );

  return (
    <div className="min-w-0 flex-1 space-y-2">
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
      {token ? null : failed ? (
        <Alert
          type="warning"
          announce="polite"
          title={copy.failedTitle}
          message={copy.failedText}
          action={restart}
          actionLayout="stacked"
        />
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="text-sm text-gray-600">{copy.hint}</p>
          {restart}
        </div>
      )}
    </div>
  );
}
