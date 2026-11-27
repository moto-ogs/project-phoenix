"use client";

// Sortierung einer Tabelle der Kindakte am Telefon (#8070, Erreichbarkeit):
// Am Computer sortiert ein Tipp auf den Spaltenkopf. Am Telefon steht die
// Tabelle als Kartenliste ohne Spaltenköpfe; dieselben Sortierungen stehen
// hier als Auswahlliste über der Liste, gebaut wie „Anzeigen“ der Dokumente.

import { useState } from "react";

import { CustomSelect } from "~/components/ui/custom-select";
import { FieldLabel } from "~/components/ui/field-label";
import { useIsApp } from "~/lib/device-context";

export interface PhoneSortOption {
  readonly value: string;
  readonly label: string;
  /** Spalte der Tabelle (`DataTableColumn.key`) mit `sortValue`. */
  readonly sortKey: string;
  readonly direction: "asc" | "desc";
}

/**
 * Gewählte Sortierung am Telefon. Am Computer `null`: Dort bleibt die
 * Tabelle mit ihren Spaltenköpfen unverändert.
 */
export function usePhoneTableSort(options: readonly PhoneSortOption[]) {
  const app = useIsApp();
  const [value, setValue] = useState(options[0]?.value ?? "");
  const selected =
    options.find((option) => option.value === value) ?? options[0];
  return { app, value, setValue, selected: app ? selected : undefined };
}

export function PhoneTableSort({
  id,
  options,
  value,
  onChange,
}: Readonly<{
  id: string;
  options: readonly PhoneSortOption[];
  value: string;
  onChange: (value: string) => void;
}>) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <FieldLabel htmlFor={id} className="mb-0">
        Sortieren
      </FieldLabel>
      <CustomSelect
        id={id}
        value={value}
        options={options.map(({ value: v, label }) => ({ value: v, label }))}
        onChange={onChange}
        controlSize="dense"
        className="w-56"
      />
    </div>
  );
}
