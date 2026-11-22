// Texte und Zustände der neuen Zuordnung der Module (#7764): was moto mit
// jedem Vertrag der Datei macht und was ihn aufhält, in den Worten des
// Träger-Büros. Reine Anzeige; jede Prüfung macht das Backend.

import type { StatusBadgeTone } from "~/components/ui/status-badge";
import { formatDate } from "~/lib/date-helpers";
import type {
  OfferingCorrectionContract,
  OfferingCorrectionField,
  OfferingCorrectionProblem,
  OfferingCorrectionStatus,
} from "~/lib/traeger-offering-correction-api";

export const OFFERING_CORRECTION_STATUS: Record<
  OfferingCorrectionStatus,
  { readonly label: string; readonly tone: StatusBadgeTone }
> = {
  ready: { label: "Wird geändert", tone: "green" },
  unchanged: { label: "Schon zugeordnet", tone: "gray" },
  held: { label: "Zurückgestellt", tone: "orange" },
  invalid: { label: "Nicht möglich", tone: "red" },
  corrected: { label: "Geändert", tone: "green" },
};

/** Die Spalten der Datei, mit den Überschriften, die moto erkennt. */
export const OFFERING_CORRECTION_COLUMNS: Record<
  OfferingCorrectionField,
  { readonly label: string; readonly header: string }
> = {
  contract: { label: "Vertrag", header: "Vertrag" },
  weekday: { label: "Wochentag", header: "Wochentag" },
  current_offering: { label: "Bisheriges Modul", header: "Bisheriges_Modul" },
  target_offering: { label: "Neues Modul", header: "Neues_Modul" },
};

/** Eine Beispieldatei mit den Überschriften, die moto von selbst erkennt. */
export const OFFERING_CORRECTION_SAMPLE = [
  "Vertrag;Wochentag;Bisheriges_Modul;Neues_Modul",
  "41;Mo-Do;OGS 4 Tage;OGS Regelschule",
  "41;Fr;Freitag kurz;OGS Regelschule",
  "57;Mo-Fr;OGS 5 Tage;",
].join("\r\n");

/** „1 Vertrag“, „12 Verträge“. */
export function contractCount(count: number): string {
  return count === 1 ? "1 Vertrag" : `${count} Verträge`;
}

/**
 * Der Erste des nächsten Monats nach `today` ("YYYY-MM-DD"): der übliche
 * Tag, ab dem ein Vertrag anders abgerechnet wird.
 */
export function firstOfNextMonth(today: string): string {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
}

/** Name des Kindes, „“ ohne Namen. */
export function correctionChild(contract: OfferingCorrectionContract): string {
  return `${contract.childFirstName} ${contract.childLastName}`.trim();
}

const MISSING_TEXT: Record<OfferingCorrectionField, string> = {
  contract: "Die Vertragsnummer fehlt.",
  weekday: "Der Wochentag fehlt.",
  current_offering: "Das bisherige Modul fehlt.",
  target_offering: "Das neue Modul fehlt.",
};

const INVALID_TEXT: Record<OfferingCorrectionField, string> = {
  contract: "Die Vertragsnummer ist keine Zahl.",
  weekday: "Der Wochentag ist nicht lesbar. Beispiel: Mo, Mo-Fr oder Montag.",
  current_offering: "Das bisherige Modul ist nicht lesbar.",
  target_offering: "Das neue Modul ist nicht lesbar.",
};

const UNKNOWN_TEXT: Record<OfferingCorrectionField, string> = {
  contract: "Diesen Vertrag gibt es bei deinem Träger nicht.",
  weekday: "Diesen Wochentag kennt moto nicht.",
  current_offering:
    "Das bisherige Modul gibt es an der Schule des Vertrags nicht.",
  target_offering: "Das neue Modul gibt es an der Schule des Vertrags nicht.",
};

const AMBIGUOUS_TEXT: Record<OfferingCorrectionField, string> = {
  contract: "Die Vertragsnummer ist nicht eindeutig.",
  weekday: "Der Wochentag ist nicht eindeutig.",
  current_offering:
    "Der Name passt an diesem Tag zu mehreren Buchungen. Nimm den Namen, der im Vertrag steht.",
  target_offering: "Mehrere Module der Schule heißen wie das neue.",
};

function problemSentence(problem: OfferingCorrectionProblem): string {
  const { field } = problem;
  switch (problem.code) {
    case "missing":
      return field ? MISSING_TEXT[field] : "Ein Feld fehlt.";
    case "invalid":
      return field ? INVALID_TEXT[field] : "Ein Feld ist nicht lesbar.";
    case "unknown":
      return field ? UNKNOWN_TEXT[field] : "Ein Feld kennt moto nicht.";
    case "ambiguous":
      return field ? AMBIGUOUS_TEXT[field] : "Ein Feld ist nicht eindeutig.";
    case "follows_bookings":
      return "Der Vertrag kommt aus einer Anmeldung. Ändere die Buchung bei der Schule.";
    case "not_active":
      return "Der Vertrag läuft nicht: Er ist noch nicht abgeschlossen oder schon beendet.";
    case "ended":
      return "Der Vertrag endet vor dem Tag bei „Gilt ab“.";
    case "later_version":
      return "Der Vertrag ändert sich schon später. Wähle bei „Gilt ab“ einen späteren Tag.";
    case "not_booked":
      return "Der Vertrag bucht das bisherige Modul an diesem Tag nicht.";
    case "repeated":
      return "Diese Buchung steht schon in einer anderen Zeile.";
    case "overlapping":
      return "Ein Modul ist an diesem Tag zugleich bisheriges und neues Modul. Nenne je Buchung nur ihr Ziel.";
    case "inactive":
      return "Das neue Modul ist ausgeschaltet.";
    case "outside_phase":
      return "Das neue Modul läuft nicht in der ganzen Zeit der Buchung. Sein Schuljahr passt nicht.";
    case "not_offered":
      return "Das neue Modul läuft an diesem Wochentag nicht.";
    case "double_booked":
      return "Der Vertrag hätte das neue Modul zweimal am selben Tag.";
    default:
      return "Diese Zeile prüfen.";
  }
}

/** Was einen Vertrag aufhält, als Satz mit der Zeile der Datei. */
function correctionProblemText(problem: OfferingCorrectionProblem): string {
  return `Zeile ${problem.line}: ${problemSentence(problem)}`;
}

/** Hinweise, die einen Vertrag nicht aufhalten. */
function correctionHintText(
  hint: string,
  contract: OfferingCorrectionContract,
): string | null {
  switch (hint) {
    case "start_moved":
      return contract.effectiveFrom
        ? `Der Vertrag beginnt erst am ${formatDate(contract.effectiveFrom)}. Die Änderung gilt ab diesem Tag.`
        : "Der Vertrag beginnt später. Die Änderung gilt ab seinem ersten Tag.";
    case "end_time_differs":
      return "Das neue Modul endet an einem Tag zu einer anderen Zeit. Der Vertrag behält seine Endzeit. Prüfe, ob das passt.";
    default:
      return null;
  }
}

/** Alle Sätze unter dem Stand eines Vertrags: Probleme zuerst. */
export function correctionNotes(
  contract: OfferingCorrectionContract,
): string[] {
  const lines = contract.problems.map(correctionProblemText);
  if (contract.status === "held") {
    lines.push(
      "Für eine Buchung fehlt noch das neue Modul. moto ändert den Vertrag erst, wenn alle feststehen.",
    );
  }
  if (contract.status === "unchanged") {
    lines.push("Der Vertrag bucht schon die neuen Module.");
  }
  for (const hint of contract.hints) {
    // The moved start stands in the column „Gilt ab“.
    if (hint === "start_moved") continue;
    const text = correctionHintText(hint, contract);
    if (text) lines.push(text);
  }
  return lines;
}

export type OfferingCorrectionFilter =
  "all" | "ready" | "unchanged" | "held" | "invalid";

/** Ob ein Vertrag zum gewählten Filter gehört. */
export function matchesCorrectionFilter(
  contract: OfferingCorrectionContract,
  filter: OfferingCorrectionFilter,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "ready":
      return contract.status === "ready" || contract.status === "corrected";
    default:
      return contract.status === filter;
  }
}

/** „Vertrag“ und „Neues Modul“: die Spalten in der Reihenfolge der Datei. */
export function missingColumnsText(
  fields: readonly OfferingCorrectionField[],
): string {
  return fields
    .map((field) => `„${OFFERING_CORRECTION_COLUMNS[field].label}“`)
    .join(", ");
}
