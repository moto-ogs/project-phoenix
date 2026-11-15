"use client";

// Berichtsvorlage des Trägers anlegen oder ändern (#4716): Name, Abschnitte,
// üblicher Stichtag und der Sozialraum jeder Schule. Eine Schule ohne
// Sozialraum steht im Bericht unter „Ohne Sozialraum“.

import { useMemo, useRef, useState } from "react";
import { CheckboxCard } from "~/components/ui/checkbox-card";
import { CustomSelect } from "~/components/ui/custom-select";
import { EditActions } from "~/components/ui/edit-actions";
import { FormErrorAlert } from "~/components/ui/form-error-alert";
import { FormFieldset } from "~/components/ui/form-fieldset";
import { FramedList } from "~/components/ui/framed-list";
import { Input } from "~/components/ui/input";
import { SectionCard } from "~/components/ui/section-card";
import { SuggestInput } from "~/components/ui/suggest-input";
import { useApiFormError } from "~/contexts/ToastContext";
import { createLogger } from "~/lib/logger";
import type { TraegerSchool } from "~/lib/traeger-api";
import {
  REPORT_SECTIONS,
  sectionsOf,
  type ReportSection,
  type ReportTemplate,
  type ReportTemplateInput,
} from "~/lib/traeger-reports-api";
import {
  daysInMonth,
  districtNames,
  MONTH_NAMES,
  SECTION_META,
  STANDARD_KEY_DATE,
} from "./key-date-report-model";

const logger = createLogger({ component: "ReportTemplateForm" });

const NAME_MAX = 120;
const DISTRICT_MAX = 80;

const MONTH_OPTIONS = MONTH_NAMES.map((label, index) => ({
  value: String(index + 1),
  label,
}));

/** Eine neue Vorlage: alle Abschnitte, Stichtag 15.10., keine Sozialräume. */
export function blankTemplateInput(): ReportTemplateInput {
  return {
    name: "",
    sections: [...REPORT_SECTIONS],
    keyDateMonth: STANDARD_KEY_DATE.month,
    keyDateDay: STANDARD_KEY_DATE.day,
    districts: [],
  };
}

export function templateInputOf(template: ReportTemplate): ReportTemplateInput {
  return {
    name: template.name,
    sections: [...template.sections],
    keyDateMonth: template.keyDateMonth,
    keyDateDay: template.keyDateDay,
    districts: template.districts.map((entry) => ({ ...entry })),
  };
}

type FieldErrors = Record<string, string>;

/** Die Prüfungen vor dem Senden; das Backend prüft noch einmal. */
export function validateTemplateInput(
  input: ReportTemplateInput,
  takenNames: readonly string[] = [],
): FieldErrors {
  const errors: FieldErrors = {};
  const name = input.name.trim();
  if (!name) errors.name = "Bitte geben Sie einen Namen ein.";
  else if (name.length > NAME_MAX) {
    errors.name = `Der Name darf höchstens ${NAME_MAX} Zeichen haben.`;
  } else if (
    takenNames.some((taken) => taken.toLowerCase() === name.toLowerCase())
  ) {
    errors.name = "Eine Vorlage mit diesem Namen gibt es schon.";
  }
  if (input.sections.length === 0) {
    errors.sections = "Bitte wählen Sie mindestens einen Abschnitt.";
  }
  if (input.keyDateDay > daysInMonth(input.keyDateMonth)) {
    errors.key_date_day = "Diesen Tag gibt es im gewählten Monat nicht.";
  }
  for (const entry of input.districts) {
    if (entry.district.trim().length > DISTRICT_MAX) {
      errors[`district_${entry.schoolId}`] =
        `Der Sozialraum darf höchstens ${DISTRICT_MAX} Zeichen haben.`;
    }
  }
  return errors;
}

export function ReportTemplateForm({
  initial,
  schools,
  takenNames,
  saveLabel,
  onSave,
  onSaved,
  onCancel,
}: Readonly<{
  initial: ReportTemplateInput;
  schools: readonly TraegerSchool[];
  /** Namen der anderen Vorlagen; ein Name gilt nur einmal je Träger. */
  takenNames: readonly string[];
  saveLabel: string;
  onSave: (input: ReportTemplateInput) => Promise<ReportTemplate>;
  onSaved: (template: ReportTemplate) => void;
  onCancel: () => void;
}>) {
  const [draft, setDraft] = useState<ReportTemplateInput>(initial);
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const formErrors = useApiFormError(formRef);
  const fieldError = formErrors.fieldError;

  const set = <K extends keyof ReportTemplateInput>(
    key: K,
    value: ReportTemplateInput[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));

  const toggleSection = (section: ReportSection, checked: boolean) =>
    set(
      "sections",
      sectionsOf(
        checked
          ? [...draft.sections, section]
          : draft.sections.filter((entry) => entry !== section),
      ),
    );

  const districtOf = (schoolId: string) =>
    draft.districts.find((entry) => entry.schoolId === schoolId)?.district ??
    "";

  const setDistrict = (schoolId: string, district: string) =>
    set("districts", [
      ...draft.districts.filter((entry) => entry.schoolId !== schoolId),
      ...(district === "" ? [] : [{ schoolId, district }]),
    ]);

  const known = useMemo(
    () => districtNames(draft.districts),
    [draft.districts],
  );
  const mapped = draft.districts.filter((entry) =>
    entry.district.trim(),
  ).length;
  const dayOptions = useMemo(
    () =>
      Array.from({ length: daysInMonth(draft.keyDateMonth) }, (_, index) => ({
        value: String(index + 1),
        label: `${index + 1}.`,
      })),
    [draft.keyDateMonth],
  );

  const submit = async () => {
    formErrors.clear();
    const found = validateTemplateInput(draft, takenNames);
    if (Object.keys(found).length > 0) {
      formErrors.invalid("Bitte prüfen Sie die markierten Felder.", found);
      return;
    }
    setSaving(true);
    try {
      onSaved(await onSave(draft));
    } catch (err) {
      logger.error("traeger_report_template_save_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void formErrors.show(err, { object: "die Vorlage" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard
      title="Vorlage"
      description="Die Vorlage legt fest, was der Bericht zeigt. Den Stichtag können Sie beim Bericht noch ändern."
      footer={
        <EditActions
          onCancel={onCancel}
          onSave={() => formRef.current?.requestSubmit()}
          saving={saving}
          saveLabel={saveLabel}
        />
      }
    >
      <form
        ref={formRef}
        noValidate
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <FormErrorAlert message={formErrors.error} />
        <Input
          name="name"
          label="Name"
          required
          maxLength={NAME_MAX}
          value={draft.name}
          error={fieldError("name")}
          placeholder="Zum Beispiel: Jugendamt Stichtag 15.10."
          onChange={(event) => set("name", event.target.value)}
        />

        <FormFieldset
          legend="Abschnitte"
          required
          hint="Der Bericht zeigt die gewählten Abschnitte in dieser Reihenfolge."
          error={fieldError("sections")}
        >
          <div className="grid gap-3 sm:grid-cols-2" data-field="sections">
            {REPORT_SECTIONS.map((section) => (
              <CheckboxCard
                key={section}
                checked={draft.sections.includes(section)}
                onChange={(checked) => toggleSection(section, checked)}
                label={SECTION_META[section].label}
                hint={SECTION_META[section].hint}
              />
            ))}
          </div>
        </FormFieldset>

        <FormFieldset
          legend="Üblicher Stichtag"
          required
          hint="Der Bericht öffnet mit dem letzten Tag dieser Art. Üblich ist der 15. Oktober."
        >
          <div className="grid gap-3 sm:max-w-md sm:grid-cols-[6rem_1fr]">
            <CustomSelect
              id="report-template-day"
              name="key_date_day"
              ariaLabel="Tag"
              value={String(draft.keyDateDay)}
              options={dayOptions}
              error={fieldError("key_date_day")}
              onChange={(value) => set("keyDateDay", Number(value))}
            />
            <CustomSelect
              id="report-template-month"
              name="key_date_month"
              ariaLabel="Monat"
              value={String(draft.keyDateMonth)}
              options={MONTH_OPTIONS}
              onChange={(value) => {
                const month = Number(value);
                setDraft((current) => ({
                  ...current,
                  keyDateMonth: month,
                  keyDateDay: Math.min(current.keyDateDay, daysInMonth(month)),
                }));
              }}
            />
          </div>
        </FormFieldset>

        <FormFieldset
          legend="Sozialräume (freiwillig)"
          hint={
            mapped === 0
              ? "Tragen Sie bei jeder Schule ihren Sozialraum ein. Dann zählt der Bericht auch je Sozialraum. Leer heißt: ohne Sozialraum."
              : `${mapped} von ${schools.length} Schulen haben einen Sozialraum. Schulen ohne Eintrag zählen unter „Ohne Sozialraum“.`
          }
        >
          {schools.length === 0 ? (
            <p className="text-sm text-gray-500">
              Ihr Träger hat noch keine Schulen.
            </p>
          ) : (
            <FramedList maxHeight="lg">
              {schools.map((school) => (
                <li
                  key={school.id}
                  className="grid items-center gap-2 px-4 py-3 sm:grid-cols-[1fr_16rem]"
                >
                  <span className="min-w-0">
                    <span className="block font-medium text-gray-900">
                      {school.name}
                    </span>
                    {school.city ? (
                      <span className="block text-xs text-gray-500">
                        {school.city}
                      </span>
                    ) : null}
                  </span>
                  <SuggestInput
                    name={`district_${school.id}`}
                    aria-label={`Sozialraum von ${school.name}`}
                    listLabel="Vorschläge für den Sozialraum"
                    placeholder="Ohne Sozialraum"
                    controlSize="compact"
                    maxLength={DISTRICT_MAX}
                    value={districtOf(school.id)}
                    suggestions={known}
                    error={fieldError(`district_${school.id}`)}
                    onValueChange={(value) => setDistrict(school.id, value)}
                  />
                </li>
              ))}
            </FramedList>
          )}
        </FormFieldset>
      </form>
    </SectionCard>
  );
}
