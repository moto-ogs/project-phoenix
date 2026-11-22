// Ein Wert vor und nach dem Nachpflegen (#7767): der alte Wert grau und
// durchgestrichen, ein Pfeil, der neue Wert kräftig. Ein Wert, der bleibt,
// steht schlicht da. Dieselbe Darstellung zeigt die Vorschau der Liste und
// die Karte „Nachgepflegte Angaben“ am Vertrag. Nur Anzeige.

import { ArrowRight, Plus } from "lucide-react";
import { DataField } from "~/components/ui/data-field";
import type {
  ContractCorrectionChange,
  ContractCorrectionValues,
} from "~/lib/traeger-contract-correction-api";
import {
  CONTRACT_CORRECTION_COLUMNS,
  correctionDateLabel,
  correctionMethodLabel,
  partyChanges,
} from "./care-contract-correction-format";

const EMPTY = "–";

function PlainValue({ value }: Readonly<{ value: string }>) {
  return (
    <span
      className={`whitespace-nowrap ${value === EMPTY ? "text-gray-500" : "text-gray-900"}`}
    >
      {value}
    </span>
  );
}

/** „alt → neu“; ohne Änderung nur der Wert. */
function ValueChange({
  before,
  after,
  changed = true,
}: Readonly<{ before: string; after: string; changed?: boolean }>) {
  if (!changed || before === after) return <PlainValue value={after} />;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      {before === EMPTY ? (
        <span className="text-gray-500">
          <span className="sr-only">Bisher: </span>
          {EMPTY}
        </span>
      ) : (
        <del className="whitespace-nowrap text-gray-500 line-through decoration-gray-400">
          <span className="sr-only">Bisher: </span>
          {before}
        </del>
      )}
      {/* The arrow stays with the new value when the line breaks. */}
      <ins className="inline-flex items-center gap-1.5 font-semibold whitespace-nowrap text-gray-900 no-underline">
        <ArrowRight
          aria-hidden="true"
          className="h-3.5 w-3.5 shrink-0 text-gray-500"
        />
        <span className="sr-only">Neu: </span>
        {after}
      </ins>
    </span>
  );
}

/**
 * Die Vertragsparteien Platz für Platz: Ein Name bleibt, wird an seiner
 * Stelle neu geschrieben („alt → neu“) oder kommt mit „+“ dazu.
 */
function PartiesChange({
  before,
  after,
  changed = true,
}: Readonly<{
  before: readonly string[];
  after: readonly string[];
  changed?: boolean;
}>) {
  const names = changed ? after : before;
  if (!changed) {
    if (names.length === 0) return <PlainValue value={EMPTY} />;
    return (
      <ul className="space-y-0.5">
        {names.map((name, n) => (
          // Two parties may share a name; the place keeps them apart.
          <li key={`${n}-${name}`} className="whitespace-nowrap text-gray-900">
            {name}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="space-y-0.5">
      {partyChanges(before, after).map((party, n) => (
        <li key={`${n}-${party.before ?? ""}-${party.after ?? ""}`}>
          {party.before === null ? (
            <ins className="inline-flex items-center gap-1 font-semibold whitespace-nowrap text-gray-900 no-underline">
              <Plus
                aria-hidden="true"
                className="text-moto-green-strong h-3.5 w-3.5 shrink-0"
              />
              <span className="sr-only">Neu: </span>
              {party.after}
            </ins>
          ) : (
            <ValueChange
              before={party.before}
              after={party.after ?? party.before}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

/** Eine Spalte, die das Nachpflegen ändern kann, als Wert vorher und nachher. */
export function CorrectionValue({
  field,
  before,
  after,
  changed,
}: Readonly<{
  field: ContractCorrectionChange;
  before: ContractCorrectionValues;
  after: ContractCorrectionValues;
  changed: boolean;
}>) {
  switch (field) {
    case "parties":
      return (
        <PartiesChange
          before={before.parties}
          after={after.parties}
          changed={changed}
        />
      );
    case "method":
      return (
        <ValueChange
          before={correctionMethodLabel(before.method)}
          after={correctionMethodLabel(changed ? after.method : before.method)}
          changed={changed}
        />
      );
    default:
      return (
        <ValueChange
          before={correctionDateLabel(before)}
          after={correctionDateLabel(changed ? after : before)}
          changed={changed}
        />
      );
  }
}

const CHANGE_ORDER: readonly ContractCorrectionChange[] = [
  "parties",
  "method",
  "concluded_on",
];

/** Je geänderte Spalte ein Feld mit „alt → neu“, für ein `DataGrid`. */
export function CorrectionChangeFields({
  changes,
  before,
  after,
}: Readonly<{
  changes: readonly ContractCorrectionChange[];
  before: ContractCorrectionValues;
  after: ContractCorrectionValues;
}>) {
  return (
    <>
      {CHANGE_ORDER.filter((field) => changes.includes(field)).map((field) => (
        <DataField key={field} label={CONTRACT_CORRECTION_COLUMNS[field]}>
          <span className="font-normal">
            <CorrectionValue
              field={field}
              before={before}
              after={after}
              changed
            />
          </span>
        </DataField>
      ))}
    </>
  );
}
