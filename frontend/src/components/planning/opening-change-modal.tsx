"use client";

/**
 * OpeningChangeModal adds one day (or range of days) on which the OGS opens
 * or closes at other times (#7654). A single day is entered as start = end.
 * A saved day is not edited in an overlay (`bauart/no-edit-overlay`): the
 * list deletes it, and the school enters it again.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { ISODatePicker } from "~/components/ui/date-picker";
import { FieldErrorHint } from "~/components/ui/field-error-hint";
import { FormModal } from "~/components/ui/form-modal";
import { Input } from "~/components/ui/input";
import { TimeField } from "~/components/ui/time-field";
import { useFormModalPending } from "~/components/ui/use-form-modal-pending";
import { useApiFormError } from "~/contexts/ToastContext";
import { createLogger } from "~/lib/logger";
import { openingChangeService } from "~/lib/opening-change-api";

const logger = createLogger({ component: "OpeningChangeModal" });

interface OpeningChangeForm {
  readonly startDate: string;
  readonly endDate: string;
  readonly opensAt: string;
  readonly closesAt: string;
  readonly reason: string;
}

const EMPTY_FORM: OpeningChangeForm = {
  startDate: "",
  endDate: "",
  opensAt: "",
  closesAt: "",
  reason: "",
};

/** Prüfung vor dem Senden. Schlüssel sind die Feldnamen des Backends. */
function fieldErrors(form: OpeningChangeForm): Record<string, string> {
  const fields: Record<string, string> = {};
  if (!form.reason.trim()) fields.reason = "Bitte gib einen Anlass an.";
  if (!form.startDate) fields.start_date = "Bitte wähle den ersten Tag.";
  if (!form.endDate) fields.end_date = "Bitte wähle den letzten Tag.";
  if (form.startDate && form.endDate && form.endDate < form.startDate)
    fields.end_date = "Der letzte Tag darf nicht vor dem ersten liegen.";
  if (!form.opensAt) fields.opens_at = "Bitte gib an, wann die OGS öffnet.";
  if (!form.closesAt) fields.closes_at = "Bitte gib an, wann die OGS schließt.";
  if (form.opensAt && form.closesAt && form.closesAt <= form.opensAt)
    fields.closes_at = "Die OGS muss nach dem Öffnen schließen.";
  return fields;
}

export function OpeningChangeModal({
  isOpen,
  onClose,
  onSaved,
}: Readonly<{
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}>) {
  const [form, setForm] = useState<OpeningChangeForm>(EMPTY_FORM);
  const setField = <K extends keyof OpeningChangeForm>(
    key: K,
    value: OpeningChangeForm[K],
  ) => setForm((current) => ({ ...current, [key]: value }));
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
    setForm(EMPTY_FORM);
    clearErrors();
  }, [isOpen, clearErrors]);

  const handleSave = async () => {
    const fields = fieldErrors(form);
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

  const opensError = formErrors.fieldError("opens_at");
  const closesError = formErrors.fieldError("closes_at");

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
      <div ref={formRef} className="space-y-4">
        <Input
          id="opening-change-reason"
          name="reason"
          type="text"
          label="Anlass"
          value={form.reason}
          maxLength={255}
          onChange={(e) => setField("reason", e.target.value)}
          error={formErrors.fieldError("reason")}
          placeholder="z. B. Zeugnisausgabe, Elternabend"
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ISODatePicker
            id="opening-change-start"
            name="start_date"
            label="Von"
            controlSize="large"
            value={form.startDate}
            onChange={(value) =>
              setForm((current) => ({
                ...current,
                startDate: value,
                endDate:
                  !current.endDate || current.endDate < value
                    ? value
                    : current.endDate,
              }))
            }
            error={formErrors.fieldError("start_date")}
            calendarLayout="popover"
          />
          <ISODatePicker
            id="opening-change-end"
            name="end_date"
            label="Bis"
            controlSize="large"
            value={form.endDate}
            min={form.startDate || undefined}
            defaultMonth={form.startDate}
            onChange={(value) => setField("endDate", value)}
            error={formErrors.fieldError("end_date")}
            calendarLayout="popover"
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <TimeField
              name="opens_at"
              label="Öffnet um"
              required
              hint={form.opensAt ? "" : "z. B. 07:30"}
              placeholder=""
              value={form.opensAt}
              invalid={Boolean(opensError)}
              describedBy={
                opensError ? "opening-change-opens-error" : undefined
              }
              onChange={(value) => setField("opensAt", value)}
            />
            <FieldErrorHint
              id="opening-change-opens-error"
              message={opensError}
            />
          </div>
          <div>
            <TimeField
              name="closes_at"
              label="Schließt um"
              required
              hint={form.closesAt ? "" : "z. B. 12:00"}
              placeholder=""
              value={form.closesAt}
              invalid={Boolean(closesError)}
              describedBy={
                closesError ? "opening-change-closes-error" : undefined
              }
              onChange={(value) => setField("closesAt", value)}
            />
            <FieldErrorHint
              id="opening-change-closes-error"
              message={closesError}
            />
          </div>
        </div>
        <p className="text-xs text-gray-500">
          Für einen einzelnen Tag trägst du dasselbe Datum in beide Felder ein.
          Bisher zeigt moto diese Zeiten nur hier. Sitzungen und Abholzeiten
          richten sich noch nicht danach.
        </p>
      </div>
    </FormModal>
  );
}
