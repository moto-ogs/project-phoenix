"use client";

// Zuordnung der zwei Spalten beim Verknüpfen mit der Kinderakte (#7760): die
// Spalte mit der Vertragsnummer und die mit der Nummer der Kinderakte. moto
// schlägt sie aus den Überschriften vor; jede Änderung liest die Datei neu.
// Sind beide zugeordnet, klappt die Karte zu, damit die Zeilen direkt unter
// der Datei stehen.

import { useState } from "react";
import { CustomSelect } from "~/components/ui/custom-select";
import { SectionCard } from "~/components/ui/section-card";
import type {
  ChildLinkColumns,
  ChildLinkField,
} from "~/lib/traeger-contract-child-links-api";
import { CHILD_LINK_FIELD_LABELS } from "./care-contract-child-link-format";

const FIELDS: readonly ChildLinkField[] = ["contract", "child"];

const HINTS: Record<ChildLinkField, string> = {
  contract: "Die Nummer steht auf der Seite des Vertrags.",
  child: "Die Zahl am Ende der Adresse der Kinderakte im OGS-Portal.",
};

export function CareContractChildLinkMappingCard({
  headers,
  columns,
  unmapped,
  disabled,
  onChange,
}: Readonly<{
  headers: readonly string[];
  columns: ChildLinkColumns;
  unmapped: readonly ChildLinkField[];
  disabled: boolean;
  onChange: (columns: ChildLinkColumns) => void;
}>) {
  const [open, setOpen] = useState(false);
  const options = [
    { value: "", label: "Bitte wählen" },
    ...headers
      .filter((header) => header !== "")
      .map((header) => ({ value: header, label: header })),
  ];
  const missing = new Set(unmapped);
  const complete = unmapped.length === 0;
  const collapsed = complete && !open;

  return (
    <SectionCard
      title="Spalten zuordnen"
      description={
        collapsed
          ? `Vertragsnummer aus „${columns.contract}“, Nummer der Kinderakte aus „${columns.child}“.`
          : "Wähle für beide Nummern die Spalte aus deiner Datei."
      }
      collapsible={complete}
      collapsed={collapsed}
      onCollapsedChange={(next) => setOpen(!next)}
    >
      <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
        {FIELDS.map((field) => (
          <CustomSelect
            key={field}
            id={`child-link-${field}`}
            label={CHILD_LINK_FIELD_LABELS[field]}
            required
            value={columns[field]}
            options={options}
            onChange={(header) => onChange({ ...columns, [field]: header })}
            disabled={disabled}
            hint={HINTS[field]}
            error={
              !missing.has(field)
                ? null
                : field === "child" &&
                    columns.child !== "" &&
                    columns.child === columns.contract
                  ? "Wähle eine andere Spalte als für die Vertragsnummer."
                  : "Bitte eine Spalte wählen."
            }
          />
        ))}
      </div>
    </SectionCard>
  );
}
