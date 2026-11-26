"use client";

/**
 * The fields of a day with other opening hours (#7654): name, first and last
 * day, opening and closing time. The modal enters a new day with them, the
 * list changes a saved day with them in place (#8173).
 */

import { ISODatePicker } from "~/components/ui/date-picker";
import { FieldErrorHint } from "~/components/ui/field-error-hint";
import { Input } from "~/components/ui/input";
import { TimeField } from "~/components/ui/time-field";
import { parseISODate, toISODate } from "~/lib/date-helpers";
import type { OpeningChange } from "~/lib/opening-change-api";

export interface OpeningChangeForm {
  readonly startDate: string;
  readonly endDate: string;
  readonly opensAt: string;
  readonly closesAt: string;
  readonly reason: string;
}

export const EMPTY_OPENING_CHANGE_FORM: OpeningChangeForm = {
  startDate: "",
  endDate: "",
  opensAt: "",
  closesAt: "",
  reason: "",
};

/** The form of a saved day. */
export function openingChangeForm(change: OpeningChange): OpeningChangeForm {
  return {
    startDate: change.startDate,
    endDate: change.endDate,
    opensAt: change.opensAt,
    closesAt: change.closesAt,
    reason: change.reason,
  };
}

// The backend accepts 366 calendar days including start and end.
const MAX_OPENING_CHANGE_DAY_OFFSET = 365;

function maximumEndDate(startDate: string, listMaxDate: string): string {
  const day = parseISODate(startDate);
  day.setDate(day.getDate() + MAX_OPENING_CHANGE_DAY_OFFSET);
  const rangeEnd = toISODate(day);
  return rangeEnd < listMaxDate ? rangeEnd : listMaxDate;
}

function endDateAfterStart(
  currentEndDate: string,
  startDate: string,
  listMaxDate: string,
): string {
  if (!currentEndDate || currentEndDate < startDate) return startDate;
  const maxDate = maximumEndDate(startDate, listMaxDate);
  return currentEndDate > maxDate ? maxDate : currentEndDate;
}

/** Prüfung vor dem Senden. Schlüssel sind die Feldnamen des Backends. */
export function openingChangeFieldErrors(
  form: OpeningChangeForm,
): Record<string, string> {
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

export function OpeningChangeFields({
  idPrefix,
  form,
  onChange,
  fieldError,
  minDate,
  maxDate,
}: Readonly<{
  idPrefix: string;
  form: OpeningChangeForm;
  onChange: (update: (current: OpeningChangeForm) => OpeningChangeForm) => void;
  fieldError: (name: string) => string | undefined;
  /** Keep the days inside the editor's loaded range. */
  minDate: string;
  maxDate: string;
}>) {
  const setField = <K extends keyof OpeningChangeForm>(
    key: K,
    value: OpeningChangeForm[K],
  ) => onChange((current) => ({ ...current, [key]: value }));
  const opensError = fieldError("opens_at");
  const closesError = fieldError("closes_at");
  const endMaxDate = form.startDate
    ? maximumEndDate(form.startDate, maxDate)
    : maxDate;

  return (
    <div className="space-y-4">
      <Input
        id={`${idPrefix}-reason`}
        name="reason"
        type="text"
        label="Anlass"
        required
        value={form.reason}
        maxLength={255}
        onChange={(e) => setField("reason", e.target.value)}
        error={fieldError("reason")}
        placeholder="z. B. Zeugnisausgabe, Elternabend"
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ISODatePicker
          id={`${idPrefix}-start`}
          name="start_date"
          label="Von"
          required
          controlSize="large"
          value={form.startDate}
          min={minDate}
          max={maxDate}
          onChange={(value) =>
            onChange((current) => ({
              ...current,
              startDate: value,
              endDate: endDateAfterStart(current.endDate, value, maxDate),
            }))
          }
          error={fieldError("start_date")}
          calendarLayout="popover"
        />
        <ISODatePicker
          id={`${idPrefix}-end`}
          name="end_date"
          label="Bis"
          required
          controlSize="large"
          value={form.endDate}
          min={form.startDate || minDate}
          max={endMaxDate}
          defaultMonth={form.startDate || minDate}
          onChange={(value) => setField("endDate", value)}
          error={fieldError("end_date")}
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
            describedBy={opensError ? `${idPrefix}-opens-error` : undefined}
            onChange={(value) => setField("opensAt", value)}
          />
          <FieldErrorHint id={`${idPrefix}-opens-error`} message={opensError} />
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
            describedBy={closesError ? `${idPrefix}-closes-error` : undefined}
            onChange={(value) => setField("closesAt", value)}
          />
          <FieldErrorHint
            id={`${idPrefix}-closes-error`}
            message={closesError}
          />
        </div>
      </div>
      <p className="text-xs text-gray-500">
        Für einen einzelnen Tag trägst du dasselbe Datum in beide Felder ein. An
        diesen Tagen enden die Sitzungen zur neuen Schließzeit. Danach können
        Eltern die Abholzeit für den Tag nicht mehr ändern.
      </p>
    </div>
  );
}
