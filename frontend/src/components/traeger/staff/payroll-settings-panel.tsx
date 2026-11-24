"use client";

// Die Träger-Werte der Lohndatei (#4712, ADR 0250 Punkt 3): der
// DATEV-Mandant des Lohns und eine Lohnart je Kategorie und Art des
// Vertrags. Die Werte sind Einstellungen des Trägers (`traeger_payroll.*`);
// die Seite zeigt sie als eine Tabelle statt 40 einzelner Felder und
// speichert erst mit „Speichern“.

import { useMemo, useState } from "react";

import {
  CONTRACT_KINDS,
  CONTRACT_KIND_LABELS,
} from "~/components/traeger/staff/staff-contract-format";
import { Alert } from "~/components/ui/alert";
import { CustomSelect } from "~/components/ui/custom-select";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { EditActions } from "~/components/ui/edit-actions";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { Input } from "~/components/ui/input";
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
  onSaved,
}: Readonly<{
  schema: SettingsSchema | undefined;
  gaps: readonly PayrollGap[];
  onSaved: () => Promise<void>;
}>) {
  const { values: saved, writable } = useMemo(
    () => payrollValues(schema),
    [schema],
  );
  const [draft, setDraft] = useState<Values | null>(null);
  const [saving, setSaving] = useState(false);
  const errors = useApiFormError();
  const { success } = useToast();
  // Ein gescheitertes Nachladen steht als Ladefehler über der Tabelle, nie
  // als Fehler des Speicherns (#6652).
  const afterWrite = useRefreshAfterWrite("die Anzeige der Lohnarten", onSaved);
  const shown = draft ?? saved;
  const dirty = draft !== null && changedKeys(draft, saved).length > 0;
  const gapKeys = useMemo(
    () => new Set(gaps.map((gap) => wageTypeKey(gap.category, gap.kind))),
    [gaps],
  );

  const set = (key: string, value: string) => {
    setDraft((current) => ({ ...(current ?? saved), [key]: value.trim() }));
  };

  const save = async () => {
    if (!draft) return;
    const invalid = invalidFields(draft);
    if (Object.keys(invalid).length > 0) {
      errors.invalid("Bitte prüfe die markierten Felder.", invalid);
      return;
    }
    setSaving(true);
    errors.clear();
    try {
      for (const key of changedKeys(draft, saved)) {
        const value = draft[key] ?? "";
        if (value === "") await clearTraegerSettingValue(key);
        else await saveTraegerSettingValue(key, value);
      }
    } catch (err) {
      logger.error("traeger_payroll_settings_save_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void errors.show(err, { object: "die Lohnarten" });
      setSaving(false);
      return;
    }
    setDraft(null);
    setSaving(false);
    success(
      "Die Lohnarten sind gespeichert. Die Prüfung der Lohndatei ist neu gerechnet.",
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

  const changes = draft ? changedKeys(draft, saved).length : 0;
  const saveBar =
    writable && dirty ? (
      <StickyActionBar
        summary={changes === 1 ? "1 Änderung" : `${changes} Änderungen`}
      >
        <EditActions
          onCancel={() => {
            setDraft(null);
            errors.clear();
          }}
          onSave={() => void save()}
          saving={saving}
          saveTooltip="Speichert die Nummern für alle Schulen. Die nächste Lohndatei nutzt sie."
        />
      </StickyActionBar>
    ) : null;
  const gapText = gapSentence(gaps);

  return (
    <>
      <SectionCard
        concept={settingsConcept}
        title="DATEV-Mandant für den Lohn"
        description="Diese Nummern stehen oben in der LODAS-Datei. Sie gelten nur für den Lohn, nicht für die Buchhaltung."
        bodyClassName="mt-4 space-y-4"
      >
        <FormErrorAlert message={errors.error} />
        {afterWrite.error ? <LoadErrorAlert error={afterWrite.error} /> : null}
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

      <SectionCard
        concept={settingsConcept}
        title="Lohnarten je Art des Vertrags"
        description="Trage die Nummer aus deinem DATEV ein. Ein leeres Feld fehlt in der Lohndatei."
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
        />
      </SectionCard>
      {saveBar}
    </>
  );
}
