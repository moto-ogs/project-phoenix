"use client";

import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { CREATE_SUCCESSOR_HINT } from "./phase-expiry-warnings";

/**
 * Ein späteres Ende verlängert die Betreuung schon betreuter Kinder nicht:
 * ihr Betreuungsende bleibt (phase_window_plans.go, #6831). Wer zum neuen
 * Halbjahr weiterbetreuen und umbuchen lassen will, braucht eine
 * Anschlussphase. Ohne begonnene Phase gibt es keine betreuten Kinder.
 */
export function extendsRunningPhase(
  saved: Readonly<{ service_start_date: string; service_end_date: string }>,
  draftEnd: string,
  today: string,
): boolean {
  return (
    saved.service_start_date <= today &&
    draftEnd !== "" &&
    draftEnd > saved.service_end_date
  );
}

export function PhaseExtensionHint({
  onCreateSuccessor,
}: Readonly<{ onCreateSuccessor: () => void }>) {
  return (
    <Alert
      type="warning"
      size="compact"
      announce="polite"
      className="mt-3"
      message="Bei Kindern, die schon betreut werden, bleibt das Betreuungsende, wie es ist. Soll die Betreuung weiterlaufen und Eltern sollen umbuchen können? Dann erstellen Sie eine Anschlussphase."
      actionLayout="stacked"
      action={
        <Button
          type="button"
          variant="surface"
          size="compact"
          onClick={onCreateSuccessor}
          tooltip={CREATE_SUCCESSOR_HINT}
        >
          Anschlussphase erstellen
        </Button>
      }
    />
  );
}
