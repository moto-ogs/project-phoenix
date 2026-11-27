"use client";

/**
 * TraegerOpeningChangeModal enters a new day with other opening hours for
 * some or all schools of the Träger (#8202). A saved day is changed in place
 * in the list (`bauart/no-edit-overlay`).
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  emptyTraegerOpeningChangeForm,
  TraegerOpeningChangeFields,
  type TraegerOpeningChangeForm,
  traegerOpeningChangeFieldErrors,
  traegerOpeningChangeInput,
} from "~/components/traeger/traeger-opening-change-form";
import type { TraegerSchoolOption } from "~/components/traeger/traeger-school-choice";
import { Button } from "~/components/ui/button";
import { FormModal } from "~/components/ui/form-modal";
import { useFormModalPending } from "~/components/ui/use-form-modal-pending";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { createLogger } from "~/lib/logger";
import { createTraegerOpeningChange } from "~/lib/traeger-opening-changes";

const logger = createLogger({ component: "TraegerOpeningChangeModal" });

export function TraegerOpeningChangeModal({
  isOpen,
  onClose,
  onSaved,
  schools,
  minDate,
  maxDate,
}: Readonly<{
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  schools: readonly TraegerSchoolOption[];
  /** Keep new entries inside the year the page shows. */
  minDate: string;
  maxDate: string;
}>) {
  const [form, setForm] = useState<TraegerOpeningChangeForm>(() =>
    emptyTraegerOpeningChangeForm(schools),
  );
  const save = useFormModalPending(isOpen);
  const formRef = useRef<HTMLDivElement>(null);
  const formErrors = useApiFormError(formRef);
  const clearErrors = formErrors.clear;
  const latestSaveRef = useRef<() => void>(() => undefined);
  const { success: toastSuccess } = useToast();

  const opened = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      opened.current = false;
      return;
    }
    if (opened.current) return;
    opened.current = true;
    setForm(emptyTraegerOpeningChangeForm(schools));
    clearErrors();
  }, [isOpen, schools, clearErrors]);

  const handleSave = async () => {
    const fields = traegerOpeningChangeFieldErrors(form);
    if (Object.keys(fields).length > 0) {
      formErrors.invalid("Bitte prüfe die markierten Felder.", fields);
      return;
    }
    await save.run(async (op) => {
      formErrors.clear();
      const result = await createTraegerOpeningChange(
        traegerOpeningChangeInput(form),
      ).then(
        (saved) => ({ ok: true, saved }) as const,
        (error: unknown) => ({ ok: false, error }) as const,
      );
      if (!result.ok) {
        logger.error("traeger_opening_change_save_failed", {
          error:
            result.error instanceof Error
              ? result.error.message
              : String(result.error),
        });
        if (!op.isCurrent()) return;
        await formErrors.show(result.error, {
          object: "das Speichern der geänderten Öffnungszeit",
          retry: () => latestSaveRef.current(),
        });
        return;
      }
      toastSuccess(`„${result.saved.reason}“ ist gespeichert.`);
      onSaved();
      if (!op.isCurrent()) return;
      onClose();
    });
  };
  useLayoutEffect(() => {
    latestSaveRef.current = () => void handleSave();
  });

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      title="Geänderte Öffnungszeit anlegen"
      size="md"
      pending={save}
      error={formErrors.error}
      footer={
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={onClose}
            noTooltip="Schließt nur das Fenster, ohne etwas zu speichern."
          >
            Abbrechen
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => void handleSave()}
            disabled={save.pending}
            tooltip="Speichert die Öffnungszeit für die gewählten Schulen."
          >
            {save.pending ? "Speichern..." : "Speichern"}
          </Button>
        </div>
      }
    >
      <div ref={formRef}>
        <TraegerOpeningChangeFields
          idPrefix="traeger-opening-change"
          form={form}
          onChange={setForm}
          fieldError={formErrors.fieldError}
          schools={schools}
          minDate={minDate}
          maxDate={maxDate}
        />
      </div>
    </FormModal>
  );
}
