"use client";

// Wer den Ferienbeitrag bezahlt (#5627): die Familie, niemand (Befreiung)
// oder ein Kostenträger des Trägers. Die Auswahl steht beim Bestätigen in
// der Karte „Status“ und danach im Bearbeiten-Zustand „Zahler ändern“
// (#8158). Befreiung und Kostenübernahme schließen sich aus; jede Wahl
// erscheint nur, wenn der Träger eine Befreiungsregel oder einen aktiven
// Kostenträger hat.

import { ChoiceTile } from "~/components/ui/choice-tile";
import { CustomSelect } from "~/components/ui/custom-select";
import { FieldLabel } from "~/components/ui/field-label";
import { Radio } from "~/components/ui/radio";
import type {
  HolidayContribution,
  HolidayPayerKind,
} from "~/lib/traeger-contributions-api";
import type { CostBearerChoice } from "~/lib/traeger-holiday-registrations-api";

/** Who pays the frozen contribution. */
export function holidayPayerOf(contribution: HolidayContribution) {
  if (contribution.benefitsExemption) {
    return {
      kind: "exemption",
      costBearerId: null,
      costBearerName: "",
    } as const;
  }
  if (contribution.costBearerId) {
    return {
      kind: "cost_bearer",
      costBearerId: contribution.costBearerId,
      costBearerName: contribution.costBearerName ?? "",
    } as const;
  }
  return { kind: "family", costBearerId: null, costBearerName: "" } as const;
}

/** Who pays, in the words of the choice and of the history. */
export function holidayPayerText(payer: {
  readonly kind: HolidayPayerKind;
  readonly costBearerName?: string;
}): string {
  switch (payer.kind) {
    case "family":
      return "Die Familie";
    case "exemption":
      return "Niemand, die Familie ist befreit (Leistungsbezug)";
    case "cost_bearer":
      return payer.costBearerName
        ? `Kostenträger: ${payer.costBearerName}`
        : "Ein Kostenträger";
  }
}

export function HolidayPayerChoiceField({
  idPrefix = "holiday-registration",
  payer,
  exemptionAvailable,
  costBearers,
  costBearerId,
  onPayerChange,
  onCostBearerChange,
}: Readonly<{
  /** Keeps the ids apart when two choices could be on one page. */
  idPrefix?: string;
  payer: HolidayPayerKind;
  exemptionAvailable: boolean;
  costBearers: readonly CostBearerChoice[];
  costBearerId: string | null;
  onPayerChange: (payer: HolidayPayerKind) => void;
  onCostBearerChange: (id: string) => void;
}>) {
  const options: {
    value: HolidayPayerKind;
    label: string;
    description: string;
  }[] = [
    {
      value: "family",
      label: "Die Familie bezahlt",
      description: "Die Familie bekommt eine Rechnung über den Betrag.",
    },
  ];
  if (exemptionAvailable) {
    options.push({
      value: "exemption",
      label: "Von der Zahlung befreien (Leistungsbezug)",
      description: "Dann gilt die Befreiungsregel. Niemand bezahlt den Betrag.",
    });
  }
  if (costBearers.length > 0) {
    options.push({
      value: "cost_bearer",
      label: "Kosten übernimmt ein Kostenträger",
      description:
        "Die Familie bezahlt nichts. Du forderst den Betrag beim Kostenträger an.",
    });
  }
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-medium text-gray-700">
        Wer bezahlt den Beitrag?
      </legend>
      <div className="flex flex-col gap-2 sm:max-w-xl">
        {options.map((option) => {
          const id = `${idPrefix}-payer-${option.value}`;
          return (
            <ChoiceTile
              key={option.value}
              htmlFor={id}
              selected={payer === option.value}
              className="items-start p-3"
            >
              <Radio
                id={id}
                name="payer"
                value={option.value}
                checked={payer === option.value}
                onChange={() => onPayerChange(option.value)}
                className="mt-0.5"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-gray-900">
                  {option.label}
                </span>
                <span className="mt-0.5 block text-sm font-normal text-gray-600">
                  {option.description}
                </span>
              </span>
            </ChoiceTile>
          );
        })}
        {payer === "cost_bearer" ? (
          <div>
            <FieldLabel
              id={`${idPrefix}-cost-bearer-label`}
              htmlFor={`${idPrefix}-cost-bearer`}
            >
              Kostenträger
            </FieldLabel>
            <CustomSelect
              id={`${idPrefix}-cost-bearer`}
              name="cost_bearer_id"
              ariaLabelledBy={`${idPrefix}-cost-bearer-label`}
              value={costBearerId ?? ""}
              options={costBearers.map((bearer) => ({
                value: bearer.id,
                label: bearer.name,
              }))}
              onChange={onCostBearerChange}
              wrapLabels
            />
          </div>
        ) : null}
      </div>
    </fieldset>
  );
}
