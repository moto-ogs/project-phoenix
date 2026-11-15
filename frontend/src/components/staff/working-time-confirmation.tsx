"use client";

// Rückfrage bei einem Verstoß gegen eine Arbeitszeitregel (#4708, ADR 0242).
// Lehnt das Backend eine Schicht mit `workforce.shift_working_time_warning`
// ab, zeigt der Dialog jeden Hinweis in einem Satz. Wer trotzdem plant,
// bestätigt und gibt, wo eine Regel es verlangt, eine Begründung an. Danach
// sendet der Aufrufer denselben Speicheraufruf noch einmal, mit der Antwort.
// Dieselbe Rückfrage nutzen der Dienstplan der Schule und die Einsatzplanung
// des Trägers.

import { useCallback, useRef, useState, type ReactNode } from "react";

import { ConfirmationModal } from "~/components/ui/modal";
import { Textarea } from "~/components/ui/textarea";
import {
  WORKING_TIME_REASON_MAX,
  describeWorkingTimeWarning,
  workingTimeRefusalOf,
  type WorkingTimeConfirmation,
  type WorkingTimeRefusal,
} from "~/lib/working-time";

interface WorkingTimeConfirmationState {
  /** Die gegebene Antwort für den nächsten Speicheraufruf, sonst `undefined`. */
  readonly current: () => WorkingTimeConfirmation | undefined;
  /**
   * Prüft einen Speicherfehler. Meldet er eine Arbeitszeitregel, öffnet der
   * Dialog, und `retry` läuft nach der Bestätigung. Rückgabe `true`: der
   * Aufrufer zeigt den Fehler nicht selbst.
   */
  readonly intercept: (err: unknown, retry: () => unknown) => boolean;
  /** Vergisst die Antwort, etwa beim Öffnen eines neuen Formulars. */
  readonly reset: () => void;
  /** Ob der Dialog offen ist, damit ein Modal darunter ausweichen kann. */
  readonly isOpen: boolean;
  /** Der Dialog; der Aufrufer hängt ihn in seine Overlays. */
  readonly dialog: ReactNode;
}

export function useWorkingTimeConfirmation(): WorkingTimeConfirmationState {
  const confirmation = useRef<WorkingTimeConfirmation | undefined>(undefined);
  const retryRef = useRef<(() => unknown) | null>(null);
  const [refusal, setRefusal] = useState<WorkingTimeRefusal | null>(null);
  const [reason, setReason] = useState("");

  const current = useCallback(() => confirmation.current, []);
  const reset = useCallback(() => {
    confirmation.current = undefined;
    retryRef.current = null;
    setRefusal(null);
    setReason("");
  }, []);

  const intercept = useCallback((err: unknown, retry: () => unknown) => {
    const found = workingTimeRefusalOf(err);
    if (!found) return false;
    retryRef.current = retry;
    setReason(confirmation.current?.reason ?? "");
    setRefusal(found);
    return true;
  }, []);

  const close = () => {
    retryRef.current = null;
    setRefusal(null);
  };

  const trimmed = reason.trim();
  const reasonMissing = (refusal?.reasonRequired ?? false) && trimmed === "";

  const confirm = () => {
    if (reasonMissing) return;
    confirmation.current = { confirmed: true, reason: trimmed };
    const retry = retryRef.current;
    close();
    void retry?.();
  };

  const dialog = (
    <ConfirmationModal
      isOpen={refusal !== null}
      onClose={close}
      onConfirm={confirm}
      title="Trotzdem so planen?"
      confirmText="Trotzdem planen"
      confirmVariant="warning"
      confirmTooltip="Speichert die Schicht mit Ihrer Begründung im Änderungsprotokoll."
      isConfirmDisabled={reasonMissing}
      confirmDisabledReason="Bitte schreiben Sie zuerst eine Begründung."
      isBackdropDismissDisabled
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-700">
          Die Schicht verletzt eine Arbeitszeitregel Ihres Trägers. moto zählt
          dabei alle Einsatzorte der Person.
        </p>
        <ul className="list-disc space-y-2 pl-5 text-sm text-gray-900">
          {(refusal?.warnings ?? []).map((warning) => (
            <li key={`${warning.kind}-${warning.date}`}>
              {describeWorkingTimeWarning(warning)}
            </li>
          ))}
        </ul>
        {refusal?.reasonRequired ? (
          <Textarea
            label="Begründung"
            required
            autoGrow
            rows={3}
            maxLength={WORKING_TIME_REASON_MAX}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            hint="Die Begründung steht im Änderungsprotokoll der Schule."
          />
        ) : null}
        <p className="text-sm text-gray-600">
          moto prüft die Regeln als Hilfe. Ob die Planung erlaubt ist,
          entscheiden Sie.
        </p>
      </div>
    </ConfirmationModal>
  );

  return { current, intercept, reset, isOpen: refusal !== null, dialog };
}
