"use client";

/**
 * The form of an opening change of the Träger (#8202): the fields of a
 * school's opening change (#7654) and the schools it applies to. The modal
 * enters a new day with it, the list changes a saved day with it in place.
 */

import {
  EMPTY_OPENING_CHANGE_FORM,
  OpeningChangeFields,
  type OpeningChangeForm,
  openingChangeFieldErrors,
} from "~/components/planning/opening-change-fields";
import {
  TraegerSchoolChoice,
  type TraegerSchoolOption,
} from "~/components/traeger/traeger-school-choice";
import type {
  TraegerOpeningChange,
  TraegerOpeningChangeInput,
} from "~/lib/traeger-opening-changes";

export interface TraegerOpeningChangeForm extends OpeningChangeForm {
  readonly schoolIds: readonly string[];
}

/** A new day applies to all schools until the Büro picks others. */
export function emptyTraegerOpeningChangeForm(
  schools: readonly TraegerSchoolOption[],
): TraegerOpeningChangeForm {
  return {
    ...EMPTY_OPENING_CHANGE_FORM,
    schoolIds: schools.map((school) => school.id),
  };
}

export function traegerOpeningChangeForm(
  change: TraegerOpeningChange,
): TraegerOpeningChangeForm {
  return {
    startDate: change.startDate,
    endDate: change.endDate,
    opensAt: change.opensAt,
    closesAt: change.closesAt,
    reason: change.reason,
    schoolIds: change.schoolIds,
  };
}

/** Prüfung vor dem Senden. Schlüssel sind die Feldnamen des Backends. */
export function traegerOpeningChangeFieldErrors(
  form: TraegerOpeningChangeForm,
): Record<string, string> {
  const fields = openingChangeFieldErrors(form);
  if (form.schoolIds.length === 0)
    fields.school_ids = "Bitte wähle mindestens eine Schule.";
  return fields;
}

export function traegerOpeningChangeInput(
  form: TraegerOpeningChangeForm,
): TraegerOpeningChangeInput {
  return { ...form, reason: form.reason.trim() };
}

export function TraegerOpeningChangeFields({
  idPrefix,
  form,
  onChange,
  fieldError,
  schools,
  minDate,
  maxDate,
}: Readonly<{
  idPrefix: string;
  form: TraegerOpeningChangeForm;
  onChange: (
    update: (current: TraegerOpeningChangeForm) => TraegerOpeningChangeForm,
  ) => void;
  fieldError: (name: string) => string | undefined;
  schools: readonly TraegerSchoolOption[];
  minDate: string;
  maxDate: string;
}>) {
  return (
    <div className="space-y-4">
      <OpeningChangeFields
        idPrefix={idPrefix}
        form={form}
        onChange={(update) =>
          onChange((current) => ({ ...current, ...update(current) }))
        }
        fieldError={fieldError}
        minDate={minDate}
        maxDate={maxDate}
      />
      <TraegerSchoolChoice
        schools={schools}
        selected={form.schoolIds}
        onChange={(schoolIds) =>
          onChange((current) => ({ ...current, schoolIds }))
        }
        error={fieldError("school_ids")}
      />
    </div>
  );
}
