"use client";

// Zuordnung der Spalten beim Personal-Import (#4724): je Feld einer
// Personalakte die Spalte der Datei, aus der es kommt. moto schlägt sie aus
// den Überschriften vor; jede Änderung liest die Datei neu. Pflicht sind
// Personalnummer, Vorname und Nachname; die übrigen Felder sind freiwillig.

import { CustomSelect } from "~/components/ui/custom-select";
import { SectionCard } from "~/components/ui/section-card";
import { SectionLabel } from "~/components/ui/section-label";
import type {
  StaffImportField,
  StaffImportMapping,
} from "~/lib/traeger-staff-import-api";
import {
  REQUIRED_STAFF_IMPORT_FIELDS,
  STAFF_IMPORT_FIELD_HINTS,
  STAFF_IMPORT_FIELD_LABELS,
  STAFF_IMPORT_FIELDS,
} from "./staff-import-format";

const UNMAPPED = "";

const GROUPS: { title: string; fields: readonly StaffImportField[] }[] = [
  {
    title: "Person",
    fields: ["personnel_number", "first_name", "last_name", "birthday"],
  },
  {
    title: "Bank und Steuer, freiwillig",
    fields: ["iban", "tax_id", "social_security_number"],
  },
];

export function StaffImportMappingCard({
  headers,
  mapping,
  unmapped,
  disabled,
  onChange,
}: Readonly<{
  headers: readonly string[];
  mapping: StaffImportMapping;
  unmapped: readonly StaffImportField[];
  disabled: boolean;
  onChange: (mapping: StaffImportMapping) => void;
}>) {
  const options = [
    { value: UNMAPPED, label: "Nicht übernehmen" },
    ...headers
      .filter((header) => header !== "")
      .map((header) => ({ value: header, label: header })),
  ];
  const missing = new Set(unmapped);
  const mapped = STAFF_IMPORT_FIELDS.filter(
    (field) => mapping.columns[field] !== UNMAPPED,
  ).length;
  const setColumn = (field: StaffImportField, header: string) =>
    onChange({ columns: { ...mapping.columns, [field]: header } });

  return (
    <SectionCard
      title="Spalten zuordnen"
      description={`moto hat ${mapped} von ${STAFF_IMPORT_FIELDS.length} Feldern einer Spalte zugeordnet. Prüfe die Auswahl.`}
    >
      <div className="flex flex-col gap-6">
        {GROUPS.map((group) => (
          <div key={group.title}>
            <SectionLabel as="h3" className="mb-3">
              {group.title}
            </SectionLabel>
            <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
              {group.fields.map((field) => (
                <CustomSelect
                  key={field}
                  id={`staff-import-${field}`}
                  label={STAFF_IMPORT_FIELD_LABELS[field]}
                  required={REQUIRED_STAFF_IMPORT_FIELDS.has(field)}
                  value={mapping.columns[field]}
                  options={options}
                  onChange={(header) => setColumn(field, header)}
                  disabled={disabled}
                  hint={STAFF_IMPORT_FIELD_HINTS[field]}
                  error={
                    missing.has(field) ? "Bitte eine Spalte wählen." : null
                  }
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
