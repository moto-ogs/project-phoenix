// Texte der nachgepflegten Vertragsangaben (#7767): die Spalten der Liste,
// die Zustände einer Zeile, was eine Zeile aufhält, und die Werte vor und
// nach der Änderung, in den Worten des Träger-Büros. Reine Anzeige; jede
// Prüfung macht das Backend.

import type { StatusBadgeTone } from "~/components/ui/status-badge";
import { formatDate } from "~/lib/date-helpers";
import type {
  ContractCorrectionField,
  ContractCorrectionMethod,
  ContractCorrectionProblem,
  ContractCorrectionRow,
  ContractCorrectionRowStatus,
  ContractCorrectionValues,
} from "~/lib/traeger-contract-correction-api";

/** Die Spalten, wie die heruntergeladene Liste sie überschreibt. */
export const CONTRACT_CORRECTION_COLUMNS: Record<
  ContractCorrectionField,
  string
> = {
  contract_id: "Vertrag-ID",
  child: "Kind",
  parties: "Vertragsparteien",
  method: "Abschlussart",
  concluded_on: "Abschlussdatum",
  evidence: "Beleg",
};

export const CONTRACT_CORRECTION_STATUS: Record<
  ContractCorrectionRowStatus,
  { readonly label: string; readonly tone: StatusBadgeTone }
> = {
  change: { label: "Wird geändert", tone: "blue" },
  unchanged: { label: "Bereits aktuell", tone: "gray" },
  invalid: { label: "Fehler", tone: "red" },
  corrected: { label: "Geändert", tone: "green" },
};

const METHOD_LABELS: Record<ContractCorrectionMethod, string> = {
  einfach_elektronisch: "Online",
  papier: "Papier",
};

/** „Online“ oder „Papier“; „–“ ohne Abschlussart. */
export function correctionMethodLabel(
  method: ContractCorrectionMethod | null,
): string {
  return method ? METHOD_LABELS[method] : "–";
}

/** Das Abschlussdatum; „Unbekannt“ ist nie ein Datum, „–“ ohne Abschluss. */
export function correctionDateLabel(values: ContractCorrectionValues): string {
  if (values.dateUnknown) return "Unbekannt";
  return values.concludedOn ? formatDate(values.concludedOn) : "–";
}

const PROBLEM_TEXTS: Partial<
  Record<ContractCorrectionField, Partial<Record<string, string>>>
> = {
  contract_id: {
    missing: "Die Vertrag-ID fehlt. Übernimm sie aus der Liste.",
    invalid: "Die Vertrag-ID ist keine Zahl. Übernimm sie aus der Liste.",
    unknown: "Diese Vertrag-ID gibt es bei euch nicht.",
    not_imported:
      "Dieser Vertrag kommt nicht aus einem Import. Seine Angaben stammen aus moto.",
  },
  child: {
    missing: "Das Kind fehlt. Übernimm den Namen aus der Liste.",
    child_differs: "Das Kind passt nicht zur Vertrag-ID.",
  },
  parties: {
    invalid:
      "Die Vertragsparteien sind nicht lesbar. Beispiel: Beispiel, Eva | Beispiel, Jan",
    too_long: "Ein Name ist zu lang, oder es sind mehr als 6 Vertragsparteien.",
    party_removed:
      "Eine Vertragspartei fehlt. Vorhandene Parteien bleiben im Vertrag.",
    party_unclear:
      "moto erkennt nicht sicher, welcher Name zu welcher vorhandenen Vertragspartei gehört. Ändere in dieser Zeile nur einen Namen. Die anderen Namen schreibst du wie in der heruntergeladenen Liste. Einen weiteren Namen ergänzt du mit einer zweiten Liste.",
    party_repeated: "Ein Name steht doppelt in der Zeile.",
  },
  method: {
    invalid:
      "Die Abschlussart ist nicht lesbar. Erlaubt sind online und papier.",
  },
  concluded_on: {
    invalid:
      "Das Abschlussdatum ist kein Datum. Beispiel: 12.03.2026 oder unbekannt.",
    future: "Das Datum liegt in der Zukunft.",
    after_notice: "Das Datum liegt nach der Kündigung oder dem Widerruf.",
  },
  evidence: {
    missing: "Der Beleg fehlt.",
    too_long: "Der Beleg ist zu lang.",
  },
};

/** Was eine Zeile aufhält, als ein Satz. */
export function contractCorrectionProblemText(
  problem: ContractCorrectionProblem,
  row: Pick<ContractCorrectionRow, "repeatsLine">,
): string {
  const { field, code } = problem;
  if (field === undefined) return "Diese Zeile prüfen.";
  if (code === "repeated") {
    return row.repeatsLine === null
      ? "Der Vertrag steht mehrmals in der Datei."
      : `Der Vertrag steht schon in Zeile ${row.repeatsLine}.`;
  }
  return (
    PROBLEM_TEXTS[field]?.[code] ??
    `${CONTRACT_CORRECTION_COLUMNS[field]} prüfen.`
  );
}

/** Die Probleme einer Zeile in einer Spalte, als Sätze. */
export function contractCorrectionProblemsOf(
  row: ContractCorrectionRow,
  fields: readonly (ContractCorrectionField | undefined)[],
): string[] {
  return row.problems
    .filter((problem) => fields.includes(problem.field))
    .map((problem) => contractCorrectionProblemText(problem, row));
}

/**
 * Welche Pflichtspalten der Datei fehlen: „Es fehlt die Spalte „Beleg“.“
 * oder „Es fehlen die Spalten „Vertrag-ID“ und „Kind“.“
 */
export function missingColumnsText(
  missing: readonly ContractCorrectionField[],
): string {
  const names = missing.map(
    (field) => `„${CONTRACT_CORRECTION_COLUMNS[field]}“`,
  );
  if (names.length === 1) return `Es fehlt die Spalte ${names[0]}.`;
  const last = names.at(-1) ?? "";
  return `Es fehlen die Spalten ${names.slice(0, -1).join(", ")} und ${last}.`;
}

export type ContractCorrectionFilter =
  "all" | "change" | "invalid" | "unchanged";

/** Ob eine Zeile zum gewählten Filter gehört. */
export function matchesContractCorrectionFilter(
  row: ContractCorrectionRow,
  filter: ContractCorrectionFilter,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "change":
      return row.status === "change" || row.status === "corrected";
    default:
      return row.status === filter;
  }
}

/** Ein Name einer Vertragspartei vor und nach der Änderung. */
export interface PartyChange {
  /** null: ein Name, der dazukommt. */
  readonly before: string | null;
  /** null: ein Name, den die Änderung nicht kennt (nur der Vollständigkeit). */
  readonly after: string | null;
}

/**
 * Die Vertragsparteien Platz für Platz: Ein Name bleibt, wird an seiner
 * Stelle neu geschrieben oder kommt am Ende dazu. moto entfernt keine Partei.
 */
export function partyChanges(
  before: readonly string[],
  after: readonly string[],
): PartyChange[] {
  const length = Math.max(before.length, after.length);
  return Array.from({ length }, (_, n) => ({
    before: before[n] ?? null,
    after: after[n] ?? null,
  }));
}
