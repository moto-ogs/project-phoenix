"use client";

/**
 * OpeningChangeModal adds one day (or range of days) on which the OGS opens
 * or closes at other times (#7654). A single day is entered as start = end.
 * A saved day is not edited in an overlay (`bauart/no-edit-overlay`): the
 * list changes it in place (#8173).
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  EMPTY_OPENING_CHANGE_FORM,
  OpeningChangeFields,
  type OpeningChangeForm,
  openingChangeFieldErrors,
} from "~/components/planning/opening-change-fields";
import { Button } from "~/components/ui/button";
import { FormModal } from "~/components/ui/form-modal";
import { useFormModalPending } from "~/components/ui/use-form-modal-pending";
import { useApiFormError } from "~/contexts/ToastContext";
import { createLogger } from "~/lib/logger";
import { openingChangeService } from "~/lib/opening-change-api";

const logger = createLogger({ component: "OpeningChangeModal" });

export function OpeningChangeModal({
  isOpen,
  onClose,
  onSaved,
  minDate,
  maxDate,
}: Readonly<{
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** Keep new entries inside the editor's loaded range. */
  minDate: string;
  maxDate: string;
}>) {
  const [form, setForm] = useState<OpeningChangeForm>(
    EMPTY_OPENING_CHANGE_FORM,
  );
  const save = useFormModalPending(isOpen);
  const formRef = useRef<HTMLDivElement>(null);
  const formErrors = useApiFormError(formRef);
  const clearErrors = formErrors.clear;
  const latestSaveRef = useRef<() => void>(() => undefined);

  const opened = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      opened.current = false;
      return;
    }
    if (opened.current) return;
    opened.current = true;
    setForm(EMPTY_OPENING_CHANGE_FORM);
    clearErrors();
  }, [isOpen, clearErrors]);

  const handleSave = async () => {
    const fields = openingChangeFieldErrors(form);
    if (Object.keys(fields).length > 0) {
      formErrors.invalid("Bitte prüfe die markierten Felder.", fields);
      return;
    }
    const input = { ...form, reason: form.reason.trim() };
    await save.run(async (op) => {
      formErrors.clear();
      const result = await openingChangeService.create(input).then(
        () => ({ ok: true }) as const,
        (error: unknown) => ({ ok: false, error }) as const,
      );
      if (!result.ok) {
        logger.error("opening_change_save_failed", {
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
            tooltip="Speichert die Öffnungszeit für diese Tage."
          >
            {save.pending ? "Speichern..." : "Speichern"}
          </Button>
        </div>
      }
    >
      <div ref={formRef}>
        <OpeningChangeFields
          idPrefix="opening-change"
          form={form}
          onChange={setForm}
          fieldError={formErrors.fieldError}
          minDate={minDate}
          maxDate={maxDate}
        />
      </div>
    </FormModal>
  );
}
