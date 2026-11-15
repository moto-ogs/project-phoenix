"use client";

import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useState, type Ref } from "react";

import { Button } from "~/components/ui/button";

const SCRIPT_ID = "moto-security-check-script";

export interface SecurityCheckCopy {
  /** One line under the check: what to do when it hangs. */
  readonly hint: string;
  /** Label of the button that starts the check again. */
  readonly restart: string;
  /** What the restart button does. */
  readonly restartTooltip: string;
}

/**
 * The Turnstile check of the public forms, with a way out when it hangs
 * (#7114, WCAG 3.3.8): a line says what to do and a button loads the check
 * again. The form keeps its entries; only the check starts over.
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
  return (
    <div className="space-y-1.5">
      <Turnstile
        key={attempt}
        ref={instanceRef}
        siteKey={siteKey}
        scriptOptions={{ id: SCRIPT_ID }}
        options={{ theme: "light" }}
        onSuccess={onToken}
        onExpire={() => onToken("")}
        onError={() => onToken("")}
      />
      {token ? null : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="text-sm text-gray-600">{copy.hint}</p>
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
        </div>
      )}
    </div>
  );
}
