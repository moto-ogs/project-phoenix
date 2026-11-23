"use client";

/**
 * ClosingDayModal creates or edits one OGS-Schließtag range (#1418 3b).
 * A single closed day is entered as start = end. Kept deliberately small —
 * unlike CalendarPeriodModal there is no type, cycle, or link section.
 */

import { isAccessRefusal } from "~/lib/access-refusal";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { Checkbox } from "~/components/ui/checkbox";
import { ChoiceTile } from "~/components/ui/choice-tile";
import { FormFieldset } from "~/components/ui/form-fieldset";
import { Button } from "~/components/ui/button";
import { ISODatePicker } from "~/components/ui/date-picker";
import { FormModal } from "~/components/ui/form-modal";
import { useFormModalPending } from "~/components/ui/use-form-modal-pending";
import { Input } from "~/components/ui/input";
import { useApiFormError } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import { closingDayService } from "~/lib/closing-day-api";
import { useDraftOn } from "~/lib/swr/read-draft";
import { type ClosingDay } from "~/lib/closing-day-helpers";
import { createLogger } from "~/lib/logger";
import { timetableService } from "~/lib/timetable-api";

const logger = createLogger({ component: "ClosingDayModal" });

export function ClosingDayModal({
  isOpen,
  onClose,
  onSaved,
  reload,
  initial,
  onOfferCancel,
  onSave,
  schools,
  defaultDate = "",
  reasonMaxLength = 255,
  onDraftChange,
  consequences,
  saveLabel = "Speichern",
  saveBlocked = false,
}: ClosingDayModalProps) {
  const allSchoolIds = () => schools?.map((school) => school.id) ?? [];
  const formOf = (day: StoredClosingDay): ClosingDayForm => ({
    startDate: day.startDate,
    endDate: day.endDate,
    reason: day.reason,
    schoolIds: day.schoolIds ?? allSchoolIds(),
  });
  // A new closing day's form; an existing one is the draft below.
  const [createForm, setCreateForm] = useState<ClosingDayForm>(() => ({
    startDate: defaultDate,
    endDate: defaultDate,
    reason: "",
    schoolIds: allSchoolIds(),
  }));
  // The stored closing day a refusal read, until the caller's list brings
  // it as `initial`.
  const [reread, setReread] = useState<{
    readonly from: StoredClosingDay | null;
    readonly stored: StoredClosingDay;
  } | null>(null);
  const stored =
    reread !== null && reread.from === initial ? reread.stored : initial;
  // The form of a stored closing day rests on its version (ADR 0311): a
  // later read of the list refills it only while untouched; after a refusal
  // the stored closing day shows, and nothing is sent until it is read.
  const edit = useDraftOn<
    StoredClosingDay,
    ClosingDayForm,
    string | undefined,
    void
  >(
    {
      opening: isOpen && initial ? initial.id : null,
      data: stored ?? undefined,
      reload: async () => {
        if (!reload) throw new Error("closing day cannot be read again");
        const day = await reload();
        setReread({ from: initial, stored: day });
        return day;
      },
    },
    {
      token: (day) => day.version,
      toDraft: formOf,
      // The dialog closes after a save: no read of the old state.
      answer: (_saved, shown) => shown,
    },
  );
  const form = initial ? (edit.draft ?? formOf(initial)) : createForm;
  const setForm = initial ? edit.setDraft : setCreateForm;
  const { startDate, endDate, reason, schoolIds } = form;
  const setField = <K extends keyof ClosingDayForm>(
    key: K,
    value: ClosingDayForm[K],
  ) => setForm((current) => ({ ...current, [key]: value }));
  const save = useFormModalPending(isOpen);
  const saving = save.pending;
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
    if (!initial) {
      setCreateForm({
        startDate: defaultDate,
        endDate: defaultDate,
        reason: "",
        schoolIds: schools?.map((school) => school.id) ?? [],
      });
    }
    setReread(null);
    clearErrors();
  }, [isOpen, initial, schools, defaultDate, clearErrors]);

  // Die Seite zeigt zum Entwurf, was der Schließtag bewirkt (#6434).
  const draftChanged = useRef(onDraftChange);
  useLayoutEffect(() => {
    draftChanged.current = onDraftChange;
  });
  const schoolKey = schoolIds.join(",");
  useEffect(() => {
    if (!isOpen) return;
    draftChanged.current?.({
      startDate,
      endDate,
      schoolIds: schoolKey ? schoolKey.split(",") : [],
    });
  }, [isOpen, startDate, endDate, schoolKey]);

  const allSelected =
    (schools?.length ?? 0) > 0 &&
    (schools?.every((s) => schoolIds.includes(s.id)) ?? false);
  const toggleSchool = (id: string, checked: boolean) =>
    setForm((current) => ({
      ...current,
      schoolIds: checked
        ? [...current.schoolIds, id]
        : current.schoolIds.filter((value) => value !== id),
    }));

  const handleSave = async () => {
    const fields = closingDayFieldErrors(reason, startDate, endDate);
    if (schools && schoolIds.length === 0)
      fields.school_ids = "Bitte wähle mindestens eine Schule.";
    if (Object.keys(fields).length > 0) {
      formErrors.invalid("Bitte prüfe die markierten Felder.", fields);
      return;
    }
    const body = {
      start_date: startDate,
      end_date: endDate,
      reason: reason.trim(),
    };
    await save.run(async (op) => {
      formErrors.clear();
      const send = (expectedVersion: string | undefined) =>
        onSave
          ? onSave({
              startDate,
              endDate,
              reason: reason.trim(),
              schoolIds,
              expectedVersion,
            })
          : initial
            ? closingDayService
                .update(initial.id, {
                  ...body,
                  expected_version: expectedVersion,
                })
                .then(() => undefined)
            : closingDayService.create(body).then(() => undefined);
      const result = initial
        ? await edit.submit((version) => send(version))
        : await send(undefined).then(
            () => ({ ok: true }) as const,
            (error: unknown) =>
              ({ ok: false, error, reload: undefined }) as const,
          );
      if (!result.ok) {
        logger.error("closing_day_save_failed", {
          error:
            result.error instanceof Error
              ? result.error.message
              : String(result.error),
        });
        if (!op.isCurrent()) return;
        // Hat jemand den Schließtag seit dem Öffnen geändert, zeigt
        // `reload` dessen Stand im Formular; gespeichert wird erst eine neue
        // Bearbeitung (ADR 0311).
        await formErrors.show(result.error, {
          object: "das Speichern des Schließtags",
          retry: () => latestSaveRef.current(),
          reload: result.reload,
        });
        return;
      }
      onSaved();
      // Eine späte Antwort schließt keinen inzwischen neuen Dialog (#6533).
      if (!op.isCurrent()) return;
      onClose();
      // #3594: Termine, die vor dem Schließtag geplant waren, bleiben im Plan.
      // Stehen noch welche im Zeitraum, bietet der Editor das Absagen an.
      await offerCancel(onOfferCancel, startDate, endDate);
    });
  };
  // „Wiederholen“ sendet den Stand, der dann im Formular steht.
  useLayoutEffect(() => {
    latestSaveRef.current = () => void handleSave();
  });

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      title={initial ? "Schließtag bearbeiten" : "Schließtag anlegen"}
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
            disabled={
              saving || saveBlocked || (initial !== null && !edit.canSubmit)
            }
            tooltip={saveTooltip(onOfferCancel, schools)}
          >
            {saving ? "Speichern..." : saveLabel}
          </Button>
        </div>
      }
    >
      <div ref={formRef} className="space-y-4">
        <Input
          id="closing-day-reason"
          name="reason"
          type="text"
          label="Grund"
          value={reason}
          maxLength={reasonMaxLength}
          onChange={(e) => setField("reason", e.target.value)}
          error={formErrors.fieldError("reason")}
          placeholder="z. B. Pädagogischer Tag, Sommerschließung"
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ISODatePicker
            id="closing-day-start"
            name="start_date"
            label="Von"
            controlSize="large"
            value={startDate}
            onChange={(value) =>
              setForm((current) => ({
                ...current,
                startDate: value,
                endDate:
                  schools && (!current.endDate || current.endDate < value)
                    ? value
                    : current.endDate,
              }))
            }
            error={formErrors.fieldError("start_date")}
            calendarLayout="popover"
          />
          <ISODatePicker
            id="closing-day-end"
            name="end_date"
            label="Bis"
            controlSize="large"
            value={endDate}
            min={startDate || undefined}
            defaultMonth={startDate}
            onChange={(value) => setField("endDate", value)}
            error={formErrors.fieldError("end_date")}
            calendarLayout="popover"
          />
        </div>

        {schools ? (
          <FormFieldset
            legend="Gilt für"
            required
            error={formErrors.fieldError("school_ids")}
          >
            <div className="space-y-2">
              <ChoiceTile selected={allSelected} className="px-3 py-2.5">
                <Checkbox
                  checked={allSelected}
                  onChange={(event) =>
                    setField(
                      "schoolIds",
                      event.target.checked ? schools.map((s) => s.id) : [],
                    )
                  }
                />
                <span className="text-sm font-semibold text-gray-900">
                  Alle Schulen
                </span>
              </ChoiceTile>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {schools.map((school) => (
                  <ChoiceTile
                    key={school.id}
                    selected={schoolIds.includes(school.id)}
                    className="px-3 py-2.5"
                  >
                    <Checkbox
                      checked={schoolIds.includes(school.id)}
                      onChange={(event) =>
                        toggleSchool(school.id, event.target.checked)
                      }
                    />
                    <span className="min-w-0 text-sm wrap-anywhere text-gray-900">
                      {school.name}
                    </span>
                  </ChoiceTile>
                ))}
              </div>
            </div>
          </FormFieldset>
        ) : null}

        {consequences}

        <p className="text-xs text-gray-500">
          {schools
            ? "An diesem Tag ist die OGS zu. Es gibt keine Ferienbetreuung, Termine fallen aus und Mitarbeitende haben kein Soll."
            : "Für einen einzelnen Tag dasselbe Datum in beide Felder eintragen. An Schließtagen fallen Termine aus und Mitarbeitende haben kein Soll."}
        </p>
      </div>
    </FormModal>
  );
}

/** The days and schools of the draft; the reason changes no effect. */
export interface ClosingDayDraft {
  readonly startDate: string;
  readonly endDate: string;
  readonly schoolIds: readonly string[];
}

type StoredClosingDay = ClosingDay & {
  readonly schoolIds?: readonly string[];
};

interface ClosingDayForm {
  readonly startDate: string;
  readonly endDate: string;
  readonly reason: string;
  readonly schoolIds: readonly string[];
}

interface ClosingDayModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSaved: () => void;
  /**
   * Reads the stored `initial` again after a save refused as changed since
   * it was read (ADR 0311); rejects when the read fails or it is gone. The
   * dialog then shows that state.
   */
  readonly reload?: () => Promise<StoredClosingDay>;
  readonly initial: StoredClosingDay | null;
  readonly schools?: readonly { readonly id: string; readonly name: string }[];
  readonly defaultDate?: string;
  readonly reasonMaxLength?: number;
  /** Persists a range outside the school's closing-day service. */
  readonly onSave?: (input: {
    startDate: string;
    endDate: string;
    reason: string;
    schoolIds: readonly string[];
    /** The version an edit replaces; undefined when creating. */
    expectedVersion?: string;
  }) => Promise<void>;
  /** Reports the draft as it changes, so the page can show its effects. */
  readonly onDraftChange?: (draft: ClosingDayDraft) => void;
  /** What the draft means beyond the calendar, such as booked holiday care. */
  readonly consequences?: ReactNode;
  /** Label of the save button, e.g. when saving also tells parents. */
  readonly saveLabel?: string;
  /** Holds the save while the consequences are still loading. */
  readonly saveBlocked?: boolean;
  /** Opens „Termine absagen“ for the saved range when appointments remain. */
  readonly onOfferCancel?: (range: {
    startDate: string;
    endDate: string;
  }) => void;
}

/**
 * Was „Speichern“ auslöst (#6751). Mit Schulauswahl speichert das Träger-Büro;
 * dann bekommen Eltern mit gebuchten Ferientagen im Zeitraum eine E-Mail.
 */
function saveTooltip(
  onOfferCancel: ClosingDayModalProps["onOfferCancel"],
  schools: ClosingDayModalProps["schools"],
): string {
  if (onOfferCancel) {
    return "Speichert den Schließtag und bietet an, Termine darin abzusagen.";
  }
  if (schools) {
    return "Speichert den Schließtag für die gewählten Schulen und informiert betroffene Eltern.";
  }
  return "Speichert den Schließtag.";
}

// #3594: Stehen im gespeicherten Zeitraum noch geplante Termine, bietet moto
// das Absagen an. Ein Fehler beim Zählen blockiert das Speichern nicht.
async function offerCancel(
  onOfferCancel: ClosingDayModalProps["onOfferCancel"],
  from: string,
  to: string,
) {
  if (!onOfferCancel) return;
  try {
    const preview = await timetableService.bulkCancel(from, to, true);
    if (preview.count > 0) onOfferCancel({ startDate: from, endDate: to });
  } catch (err) {
    logger.warn("closing_day_cancel_preview_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    // Bewusst still ohne Recht zum Absagen: der Dialog könnte nichts tun.
    if (err instanceof ApiError && isAccessRefusal(err)) {
      return;
    }
    // Sonst ist offen, ob noch Termine im Zeitraum liegen. Der Dialog
    // „Termine absagen“ zählt selbst neu und zeigt einen Fehler dort mit
    // Wiederholen; still zu bleiben ließe geplante Termine stehen.
    onOfferCancel({ startDate: from, endDate: to });
  }
}

/** Prüfung vor dem Senden. Schlüssel sind die Feldnamen des Backends. */
function closingDayFieldErrors(
  reason: string,
  startDate: string,
  endDate: string,
): Record<string, string> {
  const fields: Record<string, string> = {};
  if (!reason.trim()) fields.reason = "Bitte gib einen Grund an.";
  if (!startDate) fields.start_date = "Bitte wähle den ersten Tag.";
  if (!endDate) fields.end_date = "Bitte wähle den letzten Tag.";
  if (startDate && endDate && endDate < startDate)
    fields.end_date = "Der letzte Tag darf nicht vor dem ersten liegen.";
  return fields;
}
