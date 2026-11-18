"use client";

// Die Nummer, die die nächste Rechnung eines Nummernkreises bekommt (#7358):
// So führt ein Träger die Nummern aus seinem bisherigen Programm fort.
// Nummern gehen nie zurück; die letzte vergebene Nummer ist die Grenze.

import { useEffect, useRef, useState } from "react";
import { EditActions } from "~/components/ui/edit-actions";
import { FormModal } from "~/components/ui/form-modal";
import { Input } from "~/components/ui/input";
import { InsetPanel } from "~/components/ui/inset-panel";
import { useFormModalPending } from "~/components/ui/use-form-modal-pending";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { createLogger } from "~/lib/logger";
import {
  MAX_NUMBER_RANGE_START,
  formatInvoiceNumber,
} from "~/lib/number-range-format";
import type { NumberRange } from "~/lib/traeger-billing-api";

const logger = createLogger({ component: "NumberRangeStartModal" });

/** The whole number the field holds, or null while it is no such number. */
function parseStart(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d{1,8}$/.test(trimmed)) return null;
  const number = Number(trimmed);
  return number >= 1 && number <= MAX_NUMBER_RANGE_START ? number : null;
}

export function NumberRangeStartModal({
  open,
  onClose,
  numberRange,
  save,
  onSaved,
}: Readonly<{
  open: boolean;
  onClose: () => void;
  numberRange: NumberRange;
  save: (nextNumber: number) => Promise<unknown>;
  /** Reads the card again; its failure belongs to the card, not the dialog. */
  onSaved: () => Promise<unknown>;
}>) {
  const [value, setValue] = useState("");
  const pending = useFormModalPending(open);
  const formRef = useRef<HTMLFormElement>(null);
  const formErrors = useApiFormError(formRef);
  const { clear: clearErrors } = formErrors;
  const { success } = useToast();
  const { pattern, year, lastNumber, nextNumber } = numberRange;

  useEffect(() => {
    if (!open) return;
    setValue(String(nextNumber));
    clearErrors();
  }, [open, nextNumber, clearErrors]);

  const number = parseStart(value);
  const fieldError = formErrors.fieldError("next_number") ?? undefined;
  const hint =
    lastNumber > 0
      ? `Die letzte laufende Nummer ist ${lastNumber}. Die neue Nummer muss größer sein.`
      : "Noch keine Rechnung ausgestellt. Sie können jede Zahl ab 1 nehmen.";

  const submit = async () => {
    formErrors.clear();
    if (number === null) {
      formErrors.invalid("Bitte prüfen Sie Ihre Angaben.", {
        next_number: "Bitte geben Sie eine ganze Zahl von 1 bis 99999999 ein.",
      });
      return;
    }
    if (number <= lastNumber) {
      formErrors.invalid("Bitte prüfen Sie Ihre Angaben.", {
        next_number: `Die letzte laufende Nummer ist ${lastNumber}. Bitte geben Sie eine größere Nummer ein.`,
      });
      return;
    }
    await pending.run(async (op) => {
      try {
        await save(number);
      } catch (err) {
        logger.error("number_range_start_save_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        if (!op.isCurrent()) return;
        void formErrors.show(err, { object: "die nächste Nummer" });
        return;
      }
      success("Die nächste Nummer ist gespeichert.");
      if (op.isCurrent()) onClose();
      await onSaved();
    });
  };

  return (
    <FormModal
      isOpen={open}
      onClose={onClose}
      pending={pending}
      isBackdropDismissDisabled
      title="Nächste Nummer ändern"
      size="md"
      error={formErrors.error}
      footer={
        <EditActions
          onCancel={onClose}
          onSave={() => formRef.current?.requestSubmit()}
          saving={pending.pending}
          disabled={number === nextNumber}
          disabledReason="Ändern Sie zuerst die Nummer."
        />
      }
    >
      <form
        ref={formRef}
        noValidate
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Input
          controlSize="touch"
          id={`number-range-start-${numberRange.service}`}
          name="next_number"
          label="Laufende Nummer der nächsten Rechnung"
          inputMode="numeric"
          autoComplete="off"
          maxLength={8}
          value={value}
          // The error names the last number itself; not twice.
          hint={fieldError ? undefined : hint}
          error={fieldError}
          onChange={(event) => setValue(event.target.value)}
        />
        <InsetPanel padding="md" aria-live="polite">
          <p className="text-sm text-gray-600">
            Die nächste Rechnung bekommt die Nummer
          </p>
          <p className="mt-1 font-mono text-lg font-semibold break-all text-gray-900">
            {/* A number at or below the last issued one is never given. */}
            {number === null || number <= lastNumber
              ? "–"
              : formatInvoiceNumber(pattern, year, number)}
          </p>
        </InsetPanel>
        <ul className="list-disc space-y-1 pl-5 text-sm text-gray-600">
          <li>
            Sie wechseln von einem anderen Programm? Nehmen Sie die Nummer nach
            der letzten Rechnung Ihres bisherigen Programms.
          </li>
          {year > 0 ? (
            <li>
              Die Nummer gilt für {year}. Im nächsten Jahr beginnt die Zählung
              wieder bei 1.
            </li>
          ) : null}
          <li>
            Nummern gehen nie zurück. Ausgestellte Rechnungen behalten ihre
            Nummer.
          </li>
        </ul>
      </form>
    </FormModal>
  );
}
