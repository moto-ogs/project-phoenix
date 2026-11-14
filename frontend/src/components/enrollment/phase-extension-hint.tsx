"use client";

import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";

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

const CARE_END_STAYS =
  "Bei Kindern, die schon betreut werden, bleibt das Betreuungsende, wie es ist.";

/**
 * `onCreateSuccessor` fehlt, wenn die Phase schon eine Anschlussphase hat:
 * eine zweite lehnt das Backend ab (rollover.source_already_rolled).
 */
export function PhaseExtensionHint({
  onCreateSuccessor,
  saving,
}: Readonly<{ onCreateSuccessor?: () => void; saving: boolean }>) {
  if (!onCreateSuccessor) {
    return (
      <Alert
        type="warning"
        size="compact"
        announce="polite"
        className="mt-3"
        message={`${CARE_END_STAYS} Für die Zeit danach gibt es schon eine Anschlussphase.`}
      />
    );
  }
  return (
    <Alert
      type="warning"
      size="compact"
      announce="polite"
      className="mt-3"
      message={`${CARE_END_STAYS} Soll die Betreuung weiterlaufen und Eltern sollen umbuchen können? Dann erstellen Sie eine Anschlussphase.`}
      actionLayout="stacked"
      action={
        <Button
          type="button"
          variant="surface"
          size="compact"
          onClick={onCreateSuccessor}
          disabled={saving}
          tooltip="Öffnet das Formular für die Anschlussphase. Ihre Änderungen hier werden nicht gespeichert."
        >
          Anschlussphase erstellen
        </Button>
      }
    />
  );
}
