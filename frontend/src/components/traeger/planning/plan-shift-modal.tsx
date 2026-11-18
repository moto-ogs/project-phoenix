"use client";

// Eine Schicht der Einsatzplanung planen, ändern oder löschen (#4708). Die
// Schicht entsteht im Dienstplan der gewählten Schule. Verletzt sie eine
// Arbeitszeitregel, fragt `useWorkingTimeConfirmation` nach und sendet nach
// der Bestätigung noch einmal. Eine Überschneidung an einem anderen
// Einsatzort lehnt moto ab; der Text dazu kommt aus dem Fehlerkatalog.

import { TrashIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

import { useWorkingTimeConfirmation } from "~/components/staff/working-time-confirmation";
import { Button } from "~/components/ui/button";
import { ConfirmDeleteModal } from "~/components/ui/confirm-delete-modal";
import { CustomSelect } from "~/components/ui/custom-select";
import { ISODatePicker } from "~/components/ui/date-picker";
import { EditActions } from "~/components/ui/edit-actions";
import { FormModal } from "~/components/ui/form-modal";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { useFormModalPending } from "~/components/ui/use-form-modal-pending";
import { useApiFormError } from "~/contexts/ToastContext";
import { formatDate } from "~/lib/date-helpers";
import { createLogger } from "~/lib/logger";
import {
  changeTraegerShift,
  planTraegerShift,
  removeTraegerShift,
  type TraegerPlanningPerson,
  type TraegerPlanningShift,
} from "~/lib/traeger-planning-api";

import { suggestionSentence, type ContractSuggestion } from "./planning-format";

const logger = createLogger({ component: "PlanShiftModal" });

const BREAK_MAX = 240;

const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

/** Was der Dialog öffnet: einen freien Tag oder eine geplante Schicht. */
export type PlanShiftTarget =
  | {
      readonly kind: "create";
      readonly person: TraegerPlanningPerson;
      readonly date: string;
      /** Vorschlag aus dem Arbeitsvertrag (#7381): Einsatzort und Zeiten. */
      readonly suggestion?: ContractSuggestion;
    }
  | {
      readonly kind: "edit";
      readonly person: TraegerPlanningPerson;
      readonly shift: TraegerPlanningShift;
    };

interface Draft {
  schoolId: string;
  date: string;
  startTime: string;
  endTime: string;
  breakMinutes: string;
  notes: string;
}

function draftOf(target: PlanShiftTarget): Draft {
  if (target.kind === "edit") {
    const { shift } = target;
    return {
      schoolId: shift.schoolId,
      date: shift.date,
      startTime: shift.startTime,
      endTime: shift.endTime,
      breakMinutes: String(shift.breakMinutes),
      notes: shift.notes,
    };
  }
  const { suggestion } = target;
  if (suggestion) {
    return {
      schoolId: suggestion.schoolId,
      date: target.date,
      startTime: suggestion.startTime,
      endTime: suggestion.endTime,
      breakMinutes: String(suggestion.breakMinutes),
      notes: "",
    };
  }
  return {
    schoolId: target.person.sites[0]?.schoolId ?? "",
    date: target.date,
    startTime: "11:30",
    endTime: "16:00",
    breakMinutes: "0",
    notes: "",
  };
}

function draftErrors(draft: Draft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (draft.schoolId === "")
    errors.school_id = "Bitte einen Einsatzort wählen.";
  if (draft.date === "") errors.date = "Bitte einen Tag wählen.";
  if (draft.startTime === "") errors.start_time = "Bitte den Beginn eintragen.";
  if (draft.endTime === "") errors.end_time = "Bitte das Ende eintragen.";
  if (draft.startTime && draft.endTime && draft.endTime <= draft.startTime) {
    errors.end_time = "Bitte eine spätere Zeit wählen.";
  }
  const pause = Number(draft.breakMinutes);
  if (!Number.isInteger(pause) || pause < 0 || pause > BREAK_MAX) {
    errors.break_minutes = `Bitte 0 bis ${BREAK_MAX} Minuten eintragen.`;
  }
  return errors;
}

export function PlanShiftModal({
  target,
  onClose,
  onSaved,
}: Readonly<{
  target: PlanShiftTarget | null;
  onClose: () => void;
  /** Nach dem Speichern oder Löschen, mit dem Satz für die Erfolgsmeldung. */
  onSaved: (message: string) => void;
}>) {
  const isOpen = target !== null;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const save = useFormModalPending(isOpen);
  const remove = useFormModalPending(confirmDelete);
  const formRef = useRef<HTMLFormElement>(null);
  const errors = useApiFormError(formRef);
  const deleteErrors = useApiFormError();
  const workingTime = useWorkingTimeConfirmation();
  const { clear: clearErrors } = errors;
  const { clear: clearDeleteErrors } = deleteErrors;
  const { reset: resetWorkingTime } = workingTime;

  useEffect(() => {
    if (!target) return;
    setDraft(draftOf(target));
    setConfirmDelete(false);
    clearErrors();
    clearDeleteErrors();
    resetWorkingTime();
  }, [target, clearErrors, clearDeleteErrors, resetWorkingTime]);

  if (!target || !draft) return null;

  const { person } = target;
  const editing = target.kind === "edit";
  const name = `${person.firstName} ${person.lastName}`;
  const siteOptions = person.sites.map((site) => ({
    value: site.schoolId,
    label: site.schoolName,
  }));
  const schoolName =
    person.sites.find((site) => site.schoolId === draft.schoolId)?.schoolName ??
    (editing ? target.shift.schoolName : "");
  const set = (patch: Partial<Draft>) =>
    setDraft((current) => (current ? { ...current, ...patch } : current));

  const submit = async () => {
    const invalid = draftErrors(draft);
    if (Object.keys(invalid).length > 0) {
      errors.invalid("Bitte prüfe die markierten Felder.", invalid);
      return;
    }
    const input = {
      schoolId: draft.schoolId,
      date: draft.date,
      startTime: draft.startTime,
      endTime: draft.endTime,
      breakMinutes: Number(draft.breakMinutes),
      notes: draft.notes.trim(),
      workingTime: workingTime.current(),
    };
    await save.run(async (op) => {
      try {
        if (target.kind === "edit") {
          await changeTraegerShift(person.recordId, target.shift.id, input);
        } else {
          await planTraegerShift(person.recordId, input);
        }
        if (!op.isCurrent()) return;
        onSaved(
          editing
            ? `Die Schicht von ${name} ist geändert.`
            : `Die Schicht von ${name} steht im Dienstplan von ${schoolName}.`,
        );
      } catch (err) {
        logger.error("traeger_plan_shift_failed", {
          mode: target.kind,
          error: errorMessage(err),
        });
        if (!op.isCurrent()) return;
        if (workingTime.intercept(err, () => submit())) return;
        await errors.show(err, {
          object: "die Schicht",
          retry: () => void submit(),
        });
      }
    });
  };

  const removeShift = async () => {
    if (target.kind !== "edit") return;
    await remove.run(async (op) => {
      deleteErrors.clear();
      try {
        await removeTraegerShift(
          person.recordId,
          target.shift.schoolId,
          target.shift.id,
        );
        if (!op.isCurrent()) return;
        setConfirmDelete(false);
        onSaved(`Die Schicht von ${name} ist gelöscht.`);
      } catch (err) {
        logger.error("traeger_remove_shift_failed", {
          error: errorMessage(err),
        });
        if (op.isCurrent()) {
          void deleteErrors.show(err, { object: "die Schicht" });
        }
      }
    });
  };

  return (
    <>
      <FormModal
        isOpen={isOpen}
        onClose={onClose}
        pending={save}
        isBackdropDismissDisabled
        suspended={workingTime.isOpen || confirmDelete}
        title={editing ? "Schicht ändern" : "Schicht planen"}
        titleLevel={2}
        error={errors.error}
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            {editing ? (
              <Button
                type="button"
                size="md"
                variant="outline_danger"
                className="gap-2"
                tooltip="Löscht die Schicht im Dienstplan der Schule, moto fragt vorher nach."
                onClick={() => setConfirmDelete(true)}
              >
                <TrashIcon className="h-4 w-4" aria-hidden="true" />
                Schicht löschen
              </Button>
            ) : (
              <span />
            )}
            <EditActions
              onCancel={onClose}
              onSave={() => formRef.current?.requestSubmit()}
              saving={save.pending}
              saveLabel={editing ? "Speichern" : "Planen"}
              saveTooltip={
                editing
                  ? "Speichert die Änderung im Dienstplan der Schule."
                  : "Trägt die Schicht in den Dienstplan der Schule ein."
              }
            />
          </div>
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
          <p className="text-sm text-gray-700">
            <span className="font-medium text-gray-900">{name}</span>
            {editing && target.shift.fromSeries
              ? ". Die Schicht gehört zu einer Serie der Schule. Die Änderung gilt nur für diesen Tag."
              : null}
            {!editing && target.suggestion
              ? `. ${suggestionSentence(target.suggestion)}`
              : null}
          </p>
          {editing ? (
            <Input
              label="Einsatzort"
              value={schoolName}
              readOnly
              controlSize="compact"
              hint="Für einen anderen Einsatzort löschst du die Schicht und planst sie dort neu."
            />
          ) : (
            <CustomSelect
              label="Einsatzort"
              required
              name="school_id"
              value={draft.schoolId}
              options={siteOptions}
              onChange={(schoolId) => set({ schoolId })}
              invalid={!!errors.fieldError("school_id")}
              ariaLabel="Einsatzort"
            />
          )}
          <ISODatePicker
            controlSize="compact"
            label="Tag"
            value={draft.date}
            onChange={(date) => set({ date })}
            error={errors.fieldError("date")}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Beginn"
              type="time"
              required
              name="start_time"
              controlSize="compact"
              className="tabular-nums"
              value={draft.startTime}
              onChange={(event) => set({ startTime: event.target.value })}
              error={errors.fieldError("start_time")}
            />
            <Input
              label="Ende"
              type="time"
              required
              name="end_time"
              controlSize="compact"
              className="tabular-nums"
              value={draft.endTime}
              onChange={(event) => set({ endTime: event.target.value })}
              error={errors.fieldError("end_time")}
            />
          </div>
          <Input
            label="Pause in Minuten"
            type="number"
            name="break_minutes"
            inputMode="numeric"
            min={0}
            max={BREAK_MAX}
            controlSize="compact"
            className="tabular-nums"
            value={draft.breakMinutes}
            onChange={(event) => set({ breakMinutes: event.target.value })}
            error={errors.fieldError("break_minutes")}
          />
          <Textarea
            label="Notiz"
            rows={2}
            autoGrow
            maxLength={500}
            value={draft.notes}
            onChange={(event) => set({ notes: event.target.value })}
            hint="Die Schule sieht die Notiz im Dienstplan."
          />
        </form>
      </FormModal>
      {workingTime.dialog}
      <ConfirmDeleteModal
        isOpen={confirmDelete}
        onClose={() => {
          if (remove.pending) return;
          setConfirmDelete(false);
          deleteErrors.clear();
        }}
        onConfirm={() => void removeShift()}
        title="Schicht löschen?"
        description={
          editing
            ? `Die Schicht von ${name} am ${formatDate(target.shift.date)} verschwindet aus dem Dienstplan von ${target.shift.schoolName}.`
            : ""
        }
        confirmLabel="Löschen"
        loadingLabel="Wird gelöscht …"
        gate={{ mode: "twoStep", firstStepLabel: "Ja, löschen" }}
        loading={remove.pending}
        error={deleteErrors.error}
      />
    </>
  );
}
