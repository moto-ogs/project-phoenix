"use client";

// Die Einrichtung der Lohndatei (#4712, ADR 0250 Punkt 3; #8041, ADR 0320):
// die Form (eine Datei oder eine je Arbeitgeber), der DATEV-Mandant des
// Trägers, die Werte der anderen Arbeitgeber und eine Lohnart je Kategorie
// und Art des Vertrags. Form, Mandant und Lohnarten sind Einstellungen des
// Trägers (`traeger_payroll.*`), die Werte der Arbeitgeber gehören zur
// Personalverwaltung. Die Seite speichert alles erst mit „Speichern“.

import { useMemo, useState } from "react";

import {
  CONTRACT_KINDS,
  CONTRACT_KIND_LABELS,
} from "~/components/traeger/staff/staff-contract-format";
import {
  employerFieldKey,
  employerGap,
  PayrollEmployersCard,
} from "~/components/traeger/staff/payroll-employers-card";
import { Alert } from "~/components/ui/alert";
import { ChoiceTile } from "~/components/ui/choice-tile";
import { CustomSelect } from "~/components/ui/custom-select";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { EditActions } from "~/components/ui/edit-actions";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import type { FormErrorInput } from "~/components/ui/form-error";
import { Input } from "~/components/ui/input";
import { Radio } from "~/components/ui/radio";
import { SectionCard } from "~/components/ui/section-card";
import { StickyActionBar } from "~/components/ui/sticky-action-bar";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { settingsConcept } from "~/lib/concepts/settings";
import { useRefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import { createLogger } from "~/lib/logger";
import type { SettingsSchema } from "~/lib/settings-api";
import {
  clearTraegerSettingValue,
  saveTraegerSettingValue,
} from "~/lib/traeger-api";
import type { StaffContractKind } from "~/lib/traeger-staff-api";
import {
  CLIENT_KEY,
  CONSULTANT_KEY,
  FILE_FORM_KEY,
  savePayrollEmployer,
  type PayrollEmployer,
  type PayrollEmployerValues,
  type PayrollForm,
  PAYROLL_CATEGORIES,
  PAYROLL_CATEGORY_LABELS,
  PAYROLL_DAY_CATEGORIES,
  PAYROLL_SETTINGS_TAB,
  unitKey,
  wageTypeKey,
  type PayrollCategory,
  type PayrollGap,
} from "~/lib/traeger-staff-exports-api";

const logger = createLogger({ component: "TraegerPayrollSettings" });

type Values = Readonly<Record<string, string>>;

const UNIT_OPTIONS = [
  { value: "", label: "Einheit wählen" },
  { value: "stunden", label: "In Stunden" },
  { value: "tage", label: "In Tagen" },
];

const WAGE_TYPE_PATTERN = /^\d{1,4}$/;
const CONSULTANT_PATTERN = /^\d{1,7}$/;
const CLIENT_PATTERN = /^\d{1,5}$/;
const COST_CENTER_PATTERN = /^\d{1,8}$/;

/** Die zwei Formen der Lohndatei mit dem, was jede bedeutet (ADR 0320). */
const FORM_OPTIONS: readonly {
  readonly value: PayrollForm;
  readonly title: string;
  readonly text: string;
}[] = [
  {
    value: "traeger",
    title: "Eine Datei für den ganzen Träger",
    text: "Dein Lohnbüro rechnet alle Personen in einem DATEV-Mandanten ab. Stunden bei einer Gemeinde oder einem Schulträger tragen deren Kostenstelle.",
  },
  {
    value: "arbeitgeber",
    title: "Eine Datei je Arbeitgeber",
    text: "Jede Gemeinde und jeder Schulträger bekommt eine eigene Datei. Jede Datei hat eigene Berater- und Mandantennummer.",
  },
];

type EmployerDrafts = Readonly<Record<string, PayrollEmployerValues>>;

const savedEmployerValues = (
  employer: PayrollEmployer,
): PayrollEmployerValues => ({
  consultantNumber: employer.consultantNumber,
  clientNumber: employer.clientNumber,
  costCenter: employer.costCenter,
});

const EMPLOYER_PATTERNS: Record<
  keyof PayrollEmployerValues,
  readonly [RegExp, string]
> = {
  consultantNumber: [CONSULTANT_PATTERN, "1 bis 7 Ziffern."],
  clientNumber: [CLIENT_PATTERN, "1 bis 5 Ziffern."],
  costCenter: [COST_CENTER_PATTERN, "1 bis 8 Ziffern."],
};

/** Die Arbeitgeber, deren Werte sich im Entwurf geändert haben. */
function changedEmployers(
  employers: readonly PayrollEmployer[],
  drafts: EmployerDrafts,
): PayrollEmployer[] {
  return employers.filter((employer) => {
    const draft = drafts[employer.schoolId];
    if (!draft) return false;
    const saved = savedEmployerValues(employer);
    return (Object.keys(saved) as (keyof PayrollEmployerValues)[]).some(
      (field) => draft[field] !== saved[field],
    );
  });
}

/** Prüft die Werte der Arbeitgeber wie das Backend und nennt das Feld. */
function invalidEmployerFields(
  employers: readonly PayrollEmployer[],
  drafts: EmployerDrafts,
): Record<string, string> {
  const invalid: Record<string, string> = {};
  for (const employer of employers) {
    const draft = drafts[employer.schoolId];
    if (!draft) continue;
    for (const field of Object.keys(
      EMPLOYER_PATTERNS,
    ) as (keyof PayrollEmployerValues)[]) {
      const [pattern, message] = EMPLOYER_PATTERNS[field];
      if (draft[field] !== "" && !pattern.test(draft[field])) {
        invalid[employerFieldKey(employer.schoolId, field)] = message;
      }
    }
  }
  return invalid;
}

/** Die Werte des Bereichs `lohnexport` aus dem Schema des Trägers. */
function payrollValues(schema: SettingsSchema | undefined): {
  values: Values;
  writable: boolean;
} {
  const tab = schema?.tabs.find((entry) => entry.key === PAYROLL_SETTINGS_TAB);
  const items = tab?.categories.flatMap((category) => category.items) ?? [];
  const values: Record<string, string> = {};
  for (const item of items) {
    values[item.key] = typeof item.value === "string" ? item.value : "";
  }
  return { values, writable: items.some((item) => item.writable) };
}

/** Prüft die Nummern wie das Backend und nennt das Feld. */
function invalidFields(draft: Values): Record<string, string> {
  const invalid: Record<string, string> = {};
  const check = (key: string, pattern: RegExp, message: string) => {
    const value = draft[key] ?? "";
    if (value !== "" && !pattern.test(value)) invalid[key] = message;
  };
  check(CONSULTANT_KEY, CONSULTANT_PATTERN, "Bitte 1 bis 7 Ziffern eingeben.");
  check(CLIENT_KEY, CLIENT_PATTERN, "Bitte 1 bis 5 Ziffern eingeben.");
  for (const category of PAYROLL_CATEGORIES) {
    for (const kind of CONTRACT_KINDS) {
      check(wageTypeKey(category, kind), WAGE_TYPE_PATTERN, "1 bis 4 Ziffern.");
    }
  }
  return invalid;
}

function changedKeys(draft: Values, saved: Values): string[] {
  return Object.keys(draft).filter(
    (key) => (draft[key] ?? "") !== (saved[key] ?? ""),
  );
}

/** Die Werte, die in der Lohndatei des Monats fehlen, als ein Satz. */
function gapSentence(gaps: readonly PayrollGap[]): string | null {
  if (gaps.length === 0) return null;
  const parts = gaps.map(
    (gap) =>
      `${PAYROLL_CATEGORY_LABELS[gap.category]} bei ${CONTRACT_KIND_LABELS[gap.kind as StaffContractKind] ?? gap.kind}`,
  );
  return `Im gewählten Monat fehlen in der Datei: ${parts.join(", ")}. Trage dafür eine Lohnart ein.`;
}

export function PayrollSettingsPanel({
  schema,
  gaps,
  employers,
  employersError,
  onSaved,
}: Readonly<{
  schema: SettingsSchema | undefined;
  gaps: readonly PayrollGap[];
  employers: readonly PayrollEmployer[] | undefined;
  employersError: FormErrorInput;
  onSaved: () => Promise<void>;
}>) {
  const { values: saved, writable } = useMemo(
    () => payrollValues(schema),
    [schema],
  );
  const [draft, setDraft] = useState<Values | null>(null);
  const [employerDrafts, setEmployerDrafts] = useState<EmployerDrafts>({});
  const [saving, setSaving] = useState(false);
  const errors = useApiFormError();
  const { success } = useToast();
  // Ein gescheitertes Nachladen steht als Ladefehler über der Tabelle, nie
  // als Fehler des Speicherns (#6652).
  const afterWrite = useRefreshAfterWrite("die Anzeige der Lohnarten", onSaved);
  const shown = draft ?? saved;
  const form: PayrollForm =
    shown[FILE_FORM_KEY] === "arbeitgeber" ? "arbeitgeber" : "traeger";
  const employerList = employers ?? [];
  const employerChanges = changedEmployers(employerList, employerDrafts);
  const dirty =
    (draft !== null && changedKeys(draft, saved).length > 0) ||
    employerChanges.length > 0;
  const employerValues = (employer: PayrollEmployer) =>
    employerDrafts[employer.schoolId] ?? savedEmployerValues(employer);
  const gapKeys = useMemo(
    () => new Set(gaps.map((gap) => wageTypeKey(gap.category, gap.kind))),
    [gaps],
  );

  const set = (key: string, value: string) => {
    setDraft((current) => ({ ...(current ?? saved), [key]: value.trim() }));
  };

  const setEmployer = (
    employer: PayrollEmployer,
    field: keyof PayrollEmployerValues,
    value: string,
  ) => {
    setEmployerDrafts((current) => ({
      ...current,
      [employer.schoolId]: {
        ...(current[employer.schoolId] ?? savedEmployerValues(employer)),
        [field]: value.trim(),
      },
    }));
  };

  const save = async () => {
    const invalid = {
      ...(draft ? invalidFields(draft) : {}),
      ...invalidEmployerFields(employerList, employerDrafts),
    };
    if (Object.keys(invalid).length > 0) {
      errors.invalid("Bitte prüfe die markierten Felder.", invalid);
      return;
    }
    setSaving(true);
    errors.clear();
    try {
      for (const key of draft ? changedKeys(draft, saved) : []) {
        const value = draft?.[key] ?? "";
        if (value === "") await clearTraegerSettingValue(key);
        else await saveTraegerSettingValue(key, value);
      }
      for (const employer of employerChanges) {
        await savePayrollEmployer(employer, employerValues(employer));
      }
    } catch (err) {
      logger.error("traeger_payroll_settings_save_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void errors.show(err, { object: "die Einrichtung der Lohndatei" });
      setSaving(false);
      return;
    }
    setDraft(null);
    setEmployerDrafts({});
    setSaving(false);
    success(
      "Die Einrichtung ist gespeichert. Die Prüfung der Lohndatei ist neu gerechnet.",
    );
    await afterWrite.refresh();
  };

  const columns: DataTableColumn<PayrollCategory>[] = [
    {
      key: "category",
      header: "Kategorie",
      stacked: "title",
      render: (category) => (
        <span className="flex min-w-0 flex-col gap-2">
          <span className="font-medium text-gray-900">
            {PAYROLL_CATEGORY_LABELS[category]}
          </span>
          {PAYROLL_DAY_CATEGORIES.includes(category) ? (
            <span className="w-40">
              <CustomSelect
                ariaLabel={`Einheit ${PAYROLL_CATEGORY_LABELS[category]}`}
                value={shown[unitKey(category)] ?? ""}
                options={UNIT_OPTIONS}
                disabled={!writable}
                onChange={(value) => set(unitKey(category), value)}
              />
            </span>
          ) : null}
        </span>
      ),
    },
    ...CONTRACT_KINDS.map((kind): DataTableColumn<PayrollCategory> => ({
      key: kind,
      header: CONTRACT_KIND_LABELS[kind],
      stacked: "field",
      render: (category) => {
        const key = wageTypeKey(category, kind);
        const missing = gapKeys.has(key) && (shown[key] ?? "") === "";
        return (
          <span className="block w-24">
            <Input
              name={key}
              controlSize="compact"
              inputMode="numeric"
              maxLength={4}
              placeholder={missing ? "fehlt" : "–"}
              aria-label={`Lohnart ${PAYROLL_CATEGORY_LABELS[category]} bei ${CONTRACT_KIND_LABELS[kind]}`}
              value={shown[key] ?? ""}
              readOnly={!writable}
              error={errors.fieldError(key) ?? undefined}
              className="tabular-nums"
              onChange={(event) => set(key, event.target.value)}
            />
          </span>
        );
      },
    })),
  ];

  const changes =
    (draft ? changedKeys(draft, saved).length : 0) + employerChanges.length;
  const saveBar =
    writable && dirty ? (
      <StickyActionBar
        summary={changes === 1 ? "1 Änderung" : `${changes} Änderungen`}
      >
        <EditActions
          onCancel={() => {
            setDraft(null);
            setEmployerDrafts({});
            errors.clear();
          }}
          onSave={() => void save()}
          saving={saving}
          saveTooltip="Speichert die Einrichtung für alle Schulen. Die nächste Lohndatei nutzt sie."
        />
      </StickyActionBar>
    ) : null;
  const gapText = gapSentence(gaps);

  const missingEmployers = employerList.filter(
    (employer) => employerGap(form, employerValues(employer)) !== null,
  ).length;

  return (
    <>
      <FormErrorAlert message={errors.error} />
      {afterWrite.error ? <LoadErrorAlert error={afterWrite.error} /> : null}
      <SectionCard
        concept={settingsConcept}
        title="Wie viele Lohndateien?"
        description="Frag dein Lohnbüro, wie es die Gemeinden und Schulträger abrechnet."
        bodyClassName="mt-4"
      >
        <fieldset className="grid gap-3 md:grid-cols-2">
          <legend className="sr-only">Wie viele Lohndateien?</legend>
          {FORM_OPTIONS.map((option) => (
            <ChoiceTile
              key={option.value}
              selected={form === option.value}
              disabled={!writable}
              tone="blue"
              className="items-start p-4"
            >
              <Radio
                name={FILE_FORM_KEY}
                value={option.value}
                checked={form === option.value}
                disabled={!writable}
                onChange={() => set(FILE_FORM_KEY, option.value)}
              />
              <span className="flex min-w-0 flex-col gap-1">
                <span className="font-medium text-gray-900">
                  {option.title}
                </span>
                <span className="text-sm font-normal text-gray-600">
                  {option.text}
                </span>
              </span>
            </ChoiceTile>
          ))}
        </fieldset>
        {missingEmployers > 0 ? (
          <Alert
            type="warning"
            announce="off"
            className="mt-4"
            message={
              form === "traeger"
                ? "Für diese Form fehlt bei einem Arbeitgeber noch die Kostenstelle. Trag sie unten bei „Andere Arbeitgeber“ ein."
                : "Für diese Form fehlen bei einem Arbeitgeber noch die DATEV-Nummern. Trag sie unten bei „Andere Arbeitgeber“ ein."
            }
          />
        ) : null}
      </SectionCard>

      <SectionCard
        concept={settingsConcept}
        title="DATEV-Mandant des Trägers"
        description="Diese Nummern stehen oben in der LODAS-Datei des Trägers. Sie gelten nur für den Lohn, nicht für die Buchhaltung."
        bodyClassName="mt-4 space-y-4"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            name={CONSULTANT_KEY}
            label="Beraternummer"
            hint="1 bis 7 Ziffern, von deinem Lohnbüro."
            controlSize="compact"
            inputMode="numeric"
            maxLength={7}
            value={shown[CONSULTANT_KEY] ?? ""}
            readOnly={!writable}
            error={errors.fieldError(CONSULTANT_KEY) ?? undefined}
            onChange={(event) => set(CONSULTANT_KEY, event.target.value)}
          />
          <Input
            name={CLIENT_KEY}
            label="Mandantennummer"
            hint="1 bis 5 Ziffern, von deinem Lohnbüro."
            controlSize="compact"
            inputMode="numeric"
            maxLength={5}
            value={shown[CLIENT_KEY] ?? ""}
            readOnly={!writable}
            error={errors.fieldError(CLIENT_KEY) ?? undefined}
            onChange={(event) => set(CLIENT_KEY, event.target.value)}
          />
        </div>
      </SectionCard>

      <PayrollEmployersCard
        employers={employers}
        loadError={employersError}
        form={form}
        valuesOf={employerValues}
        writable={writable}
        fieldError={(key) => errors.fieldError(key) ?? null}
        onChange={setEmployer}
      />

      <SectionCard
        concept={settingsConcept}
        title="Lohnarten je Art des Vertrags"
        description="Trage die Nummer aus deinem DATEV ein. Sie gelten für alle Arbeitgeber. Ein leeres Feld fehlt in der Lohndatei."
        bodyClassName="mt-4 space-y-4"
      >
        {gapText ? (
          <Alert type="warning" announce="off" message={gapText} />
        ) : null}
        {!writable ? (
          <Alert
            type="info"
            announce="off"
            message="Die Nummern ändert nur, wer die Rolle Personal hat."
          />
        ) : null}
        <DataTable
          columns={columns}
          rows={[...PAYROLL_CATEGORIES]}
          getRowKey={(category) => category}
          stackedOnMobile
        />
      </SectionCard>
      {saveBar}
    </>
  );
}
