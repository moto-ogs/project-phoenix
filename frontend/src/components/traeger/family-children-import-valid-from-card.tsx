"use client";

// Der Tag, ab dem die Kinderzahlen einer Datei gelten (#7765). Er entscheidet,
// für welche Monate moto den Geschwisterpreis rechnet. Darum steht er in
// einer eigenen Karte zwischen Zuordnung und Vorschau und bleibt sichtbar,
// auch wenn die Spalten zugeklappt sind. moto schlägt den Tag des Nachtragens
// vor und setzt eine Zahl nie von selbst auf den Vertragsbeginn zurück.

import { DatePicker } from "~/components/ui/date-picker";
import { FieldLabel } from "~/components/ui/field-label";
import { SectionCard } from "~/components/ui/section-card";
import { parseISODate, toISODate } from "~/lib/date-helpers";
import type { FamilyImportMapping } from "~/lib/traeger-family-children-import-api";

// The backend takes a day from 2000 up to 2099.
const EARLIEST_DAY = parseISODate("2000-01-01");
const LATEST_DAY = parseISODate("2099-12-31");

export function FamilyChildrenImportValidFromCard({
  mapping,
  disabled,
  onChange,
}: Readonly<{
  mapping: FamilyImportMapping;
  disabled: boolean;
  onChange: (mapping: FamilyImportMapping) => void;
}>) {
  const ownDays = mapping.columns.valid_from !== "";
  return (
    <SectionCard
      title="Ab wann gelten die Zahlen?"
      description="Wähle den Tag, ab dem die Zahlen deiner Datei belegt sind. Das ist zum Beispiel der Tag, an dem du die Liste erstellt hast. Für die Monate davor zählen die Zahlen nicht."
    >
      <div className="sm:max-w-xs">
        <FieldLabel htmlFor="family-import-valid-from" required>
          Kinderzahl gilt ab
        </FieldLabel>
        <DatePicker
          id="family-import-valid-from"
          ariaLabel="Kinderzahl gilt ab"
          value={
            mapping.validFrom ? parseISODate(mapping.validFrom) : undefined
          }
          onChange={(date) => {
            // The day is required: the picker offers no way to clear it.
            if (date) onChange({ ...mapping, validFrom: toISODate(date) });
          }}
          minDate={EARLIEST_DAY}
          maxDate={LATEST_DAY}
          monthYearNavigation
          hideClearButton
          required
          disabled={disabled}
        />
      </div>
      <p className="mt-3 text-sm text-gray-600">
        {ownDays
          ? `Zeilen mit einem Tag in der Spalte „${mapping.columns.valid_from}“ nehmen ihren Tag. Dieser Tag gilt für alle anderen Zeilen. Nennen Geschwister verschiedene Tage, gilt für die Familie der früheste Tag der Zeilen, die moto übernimmt. Die Vorschau zeigt dir den Tag je Zeile.`
          : "Der Tag gilt für alle Zeilen. Nennt deine Datei den Tag je Kind, ordne oben die Spalte „Gültig ab“ zu."}
      </p>
    </SectionCard>
  );
}
