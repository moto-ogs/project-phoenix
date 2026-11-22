"use client";

// Zuordnung der Spalten beim Nachtragen der Kinderzahl (#7356): je Feld die
// Spalte der Datei, aus der es kommt. moto schlägt die Spalten aus den
// Überschriften vor; jede Änderung liest die Datei neu. Sind alle
// Pflichtfelder zugeordnet, klappt die Karte zu, damit die Zeilen direkt
// unter der Datei stehen. Hat die Datei keine Spalte für die Schule, wählt
// das Büro sie einmal für alle Zeilen. Der Tag, ab dem die Zahlen gelten,
// steht für alle Zeilen ohne eigenen Tag fest (#7765); er bleibt auch in
// der zugeklappten Karte sichtbar.

import { Fragment, useState } from "react";
import { CustomSelect } from "~/components/ui/custom-select";
import { DatePicker } from "~/components/ui/date-picker";
import { FieldLabel } from "~/components/ui/field-label";
import { SectionCard } from "~/components/ui/section-card";
import { formatDate, parseISODate, toISODate } from "~/lib/date-helpers";
import type {
  FamilyImportField,
  FamilyImportMapping,
  FamilyImportSchool,
} from "~/lib/traeger-family-children-import-api";
import {
  FAMILY_IMPORT_FIELD_HINTS,
  FAMILY_IMPORT_FIELD_LABELS,
  FAMILY_IMPORT_FIELDS,
  REQUIRED_FAMILY_IMPORT_FIELDS,
} from "./family-children-import-format";

const UNMAPPED = "";

// The backend takes a day from 2000 up to 2099.
const EARLIEST_DAY = parseISODate("2000-01-01");
const LATEST_DAY = parseISODate("2099-12-31");

const VALID_FROM_HINT =
  "Ab diesem Tag sind die Zahlen der Datei belegt, etwa der Tag des Exports oder der Bestätigung durch die Familie. moto rechnet sie nicht von selbst ab Vertragsbeginn.";

export function FamilyChildrenImportMappingCard({
  headers,
  mapping,
  unmapped,
  schools,
  disabled,
  onChange,
}: Readonly<{
  headers: readonly string[];
  mapping: FamilyImportMapping;
  unmapped: readonly FamilyImportField[];
  schools: readonly FamilyImportSchool[];
  disabled: boolean;
  onChange: (mapping: FamilyImportMapping) => void;
}>) {
  const [open, setOpen] = useState(false);
  const columnOptions = [
    { value: UNMAPPED, label: "Nicht zuordnen" },
    ...headers
      .filter((header) => header !== "")
      .map((header) => ({ value: header, label: header })),
  ];
  const missing = new Set(unmapped);
  const setColumn = (field: FamilyImportField, header: string) =>
    onChange({
      ...mapping,
      columns: { ...mapping.columns, [field]: header },
      // A column goes before the choice for all rows.
      schoolId: field === "school" && header !== "" ? "" : mapping.schoolId,
    });
  // Once every required field has its column the card folds away, so the
  // rows stand right under the file; it opens again on request.
  const complete = unmapped.length === 0;
  const collapsed = complete && !open;
  const mapped = FAMILY_IMPORT_FIELDS.filter(
    (field) => mapping.columns[field] !== UNMAPPED,
  ).length;
  const schoolForAll = mapping.columns.school === UNMAPPED;
  const ownDays = mapping.columns.valid_from !== UNMAPPED;
  const validFromText = mapping.validFrom
    ? ownDays
      ? ` Zeilen ohne eigenen Tag gelten ab ${formatDate(mapping.validFrom)}.`
      : ` Die Zahlen gelten ab ${formatDate(mapping.validFrom)}.`
    : "";

  return (
    <SectionCard
      title="Spalten zuordnen"
      description={
        collapsed
          ? `${mapped} von ${FAMILY_IMPORT_FIELDS.length} Feldern sind zugeordnet, alle Pflichtfelder sind dabei.${validFromText}`
          : "Wähle für jedes Feld die Spalte aus deiner Datei. moto hat schon passende Spalten vorgeschlagen."
      }
      collapsible={complete}
      collapsed={collapsed}
      onCollapsedChange={(next) => setOpen(!next)}
    >
      <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
        {FAMILY_IMPORT_FIELDS.map((field) => (
          <Fragment key={field}>
            <CustomSelect
              id={`family-import-${field}`}
              label={FAMILY_IMPORT_FIELD_LABELS[field]}
              required={REQUIRED_FAMILY_IMPORT_FIELDS.has(field)}
              value={mapping.columns[field]}
              options={columnOptions}
              onChange={(header) => setColumn(field, header)}
              disabled={disabled}
              hint={FAMILY_IMPORT_FIELD_HINTS[field]}
              error={
                missing.has(field) && field !== "school"
                  ? "Bitte eine Spalte wählen."
                  : null
              }
            />
            {field === "school" && schoolForAll ? (
              <CustomSelect
                id="family-import-school-for-all"
                label="Schule für alle Zeilen"
                required
                value={mapping.schoolId}
                options={[
                  { value: "", label: "Bitte wählen" },
                  ...schools.map((school) => ({
                    value: school.id,
                    label: school.name,
                  })),
                ]}
                onChange={(schoolId) => onChange({ ...mapping, schoolId })}
                disabled={disabled}
                hint="Deine Datei hat keine Spalte für die Schule. Dann gilt eine Schule für alle Kinder."
                error={
                  missing.has("school")
                    ? "Bitte eine Spalte oder eine Schule wählen."
                    : null
                }
              />
            ) : null}
            {field === "valid_from" ? (
              <div>
                <FieldLabel htmlFor="family-import-valid-from" required>
                  Kinderzahl gilt ab
                </FieldLabel>
                <DatePicker
                  id="family-import-valid-from"
                  value={
                    mapping.validFrom
                      ? parseISODate(mapping.validFrom)
                      : undefined
                  }
                  onChange={(date) => {
                    // The day is required: the picker offers no way to clear it.
                    if (date)
                      onChange({ ...mapping, validFrom: toISODate(date) });
                  }}
                  minDate={EARLIEST_DAY}
                  maxDate={LATEST_DAY}
                  monthYearNavigation
                  hideClearButton
                  required
                  disabled={disabled}
                  hint={
                    ownDays
                      ? `Zeilen mit eigenem Tag in „${mapping.columns.valid_from}“ behalten ihn. Dieser Tag gilt für alle anderen. ${VALID_FROM_HINT}`
                      : VALID_FROM_HINT
                  }
                />
              </div>
            ) : null}
          </Fragment>
        ))}
      </div>
    </SectionCard>
  );
}
