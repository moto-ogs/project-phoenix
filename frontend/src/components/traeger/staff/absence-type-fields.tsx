"use client";

// Die Felder einer Abwesenheitsart des Trägers (#4710), im Dialog zum Anlegen
// und in der Karte zum Ändern. Kontingent und Verfall erscheinen erst, wenn
// die Art ein Kontingent hat: ohne Kontingent zählt moto keine Tage.

import { CustomSelect } from "~/components/ui/custom-select";
import { Input } from "~/components/ui/input";
import { SwitchRow } from "~/components/ui/switch";
import { CARRYOVER_OPTIONS } from "~/lib/absence-helpers";
import type { TraegerAbsenceTypeInput } from "~/lib/traeger-absence-api";

export type AbsenceTypeDraft = TraegerAbsenceTypeInput;

export const EMPTY_ABSENCE_TYPE: AbsenceTypeDraft = {
  name: "",
  allowanceEnabled: true,
  standardDays: 2,
  carryoverUntil: null,
  requestable: true,
  isActive: true,
};

/** Prüft den Entwurf wie der Server; leer heißt gültig. */
export function absenceTypeDraftErrors(
  draft: AbsenceTypeDraft,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (draft.name.trim() === "") {
    errors.name = "Bitte geben Sie einen Namen ein.";
  }
  const days = draft.standardDays;
  if (
    draft.allowanceEnabled &&
    (!Number.isFinite(days) ||
      days < 0 ||
      days > 366 ||
      days * 2 !== Math.round(days * 2))
  ) {
    errors.standard_days = "Ganze oder halbe Tage zwischen 0 und 366.";
  }
  return errors;
}

// Ein Tag, der kein Monatsende ist, bleibt wählbar, wenn er schon gilt.
function carryoverOptions(current: string | null) {
  if (
    !current ||
    CARRYOVER_OPTIONS.some((option) => option.value === current)
  ) {
    return [...CARRYOVER_OPTIONS];
  }
  const [month, day] = current.split("-");
  return [
    ...CARRYOVER_OPTIONS,
    { value: current, label: `Bis ${day}.${month}. des Folgejahres` },
  ];
}

export function AbsenceTypeFields({
  idPrefix,
  draft,
  onChange,
  fieldError,
}: Readonly<{
  idPrefix: string;
  draft: AbsenceTypeDraft;
  onChange: (draft: AbsenceTypeDraft) => void;
  fieldError: (field: string) => string | undefined;
}>) {
  const set = (patch: Partial<AbsenceTypeDraft>) =>
    onChange({ ...draft, ...patch });
  return (
    <div className="space-y-4">
      <Input
        id={`${idPrefix}-name`}
        name="name"
        label="Name"
        required
        maxLength={100}
        placeholder="z. B. Regenerationstag"
        hint="Wie die Art an allen Schulen heißt. Nach der ersten Buchung bleibt der Name."
        value={draft.name}
        error={fieldError("name")}
        onChange={(event) => set({ name: event.target.value })}
      />
      <SwitchRow
        label="Tage je Person zählen (Kontingent)"
        description="Über alle Schulen einer Person. Mehr als das Kontingent lässt sich an keiner Schule eintragen."
        checked={draft.allowanceEnabled}
        onCheckedChange={(checked) => set({ allowanceEnabled: checked })}
      />
      {draft.allowanceEnabled ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            id={`${idPrefix}-standard-days`}
            name="standard_days"
            type="number"
            inputMode="decimal"
            min={0}
            max={366}
            step={0.5}
            label="Tage je Jahr"
            hint="Gilt für jede Person. In der Personalakte setzen Sie für einzelne Personen einen anderen Wert."
            value={
              Number.isFinite(draft.standardDays)
                ? String(draft.standardDays)
                : ""
            }
            error={fieldError("standard_days")}
            onChange={(event) =>
              set({
                standardDays:
                  event.target.value === ""
                    ? Number.NaN
                    : Number(event.target.value),
              })
            }
          />
          <CustomSelect
            id={`${idPrefix}-carryover`}
            label="Rest verfällt"
            hint="Bis zu diesem Tag gehen Tage im neuen Jahr zuerst vom Rest des Vorjahres ab."
            value={draft.carryoverUntil ?? ""}
            options={carryoverOptions(draft.carryoverUntil)}
            onChange={(value) => set({ carryoverUntil: value || null })}
          />
        </div>
      ) : null}
      <SwitchRow
        label="Betreuungskräfte dürfen beantragen"
        description="Der Antrag geht an die Leitung der Schule. Sie gibt frei oder lehnt ab. Ohne diesen Schalter trägt nur die Leitung ein."
        checked={draft.requestable}
        onCheckedChange={(checked) => set({ requestable: checked })}
      />
    </div>
  );
}
