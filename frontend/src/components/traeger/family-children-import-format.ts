// Texte und Zustände zum Nachtragen der Kinderzahl aus einer Datei (#7356):
// die Felder einer Zeile, ihre Zustände und was sie aufhält, in den Worten
// des Träger-Büros. Reine Anzeige; jede Prüfung macht das Backend.

import type { StatusBadgeTone } from "~/components/ui/status-badge";
import type {
  FamilyImportField,
  FamilyImportResult,
  FamilyImportRow,
  FamilyImportRowStatus,
} from "~/lib/traeger-family-children-import-api";
import { childrenLabel } from "./family-children-format";
import { labelOf } from "~/lib/label-of";

/** Die Felder in der Reihenfolge der Zuordnung. */
export const FAMILY_IMPORT_FIELDS: readonly FamilyImportField[] = [
  "child_first_name",
  "child_last_name",
  "child_birth_date",
  "children",
  "school",
  "valid_from",
];

/** Felder, die jede Datei als Spalte braucht; die Schule auch als Wahl. */
export const REQUIRED_FAMILY_IMPORT_FIELDS: ReadonlySet<FamilyImportField> =
  new Set(["child_first_name", "child_last_name", "children"]);

export const FAMILY_IMPORT_FIELD_LABELS: Record<FamilyImportField, string> = {
  child_first_name: "Vorname des Kindes",
  child_last_name: "Nachname des Kindes",
  child_birth_date: "Geburtsdatum",
  school: "Schule",
  children: "Kinder in der Familie",
  valid_from: "Gültig ab",
};

export const FAMILY_IMPORT_FIELD_HINTS: Partial<
  Record<FamilyImportField, string>
> = {
  child_birth_date: "Unterscheidet Kinder mit gleichem Namen.",
  children:
    "Alle Kinder der Familie, auch Geschwister ohne Vertrag. Eine ganze Zahl von 1 bis 20.",
  valid_from:
    "Nur wenn deine Datei den Tag pro Kind nennt. Eine leere Zelle bekommt den Tag, den du darunter für die ganze Datei wählst.",
};

const FAMILY_IMPORT_STATUS: Record<
  FamilyImportRowStatus,
  { readonly label: string; readonly tone: StatusBadgeTone }
> = {
  ready: { label: "Bereit", tone: "green" },
  same: { label: "Schon bestätigt", tone: "gray" },
  differs: { label: "Andere Zahl bestätigt", tone: "warning" },
  conflict: { label: "Widerspruch in der Datei", tone: "red" },
  invalid: { label: "Fehlerhaft", tone: "red" },
  imported: { label: "Übernommen", tone: "green" },
};

/** Gespeicherte Widersprüche werden in der Familienliste geklärt. */
export function familyImportStatus(row: FamilyImportRow): {
  readonly label: string;
  readonly tone: StatusBadgeTone;
} {
  return row.problems.some((problem) => problem.code === "confirmations_differ")
    ? { label: "Verschiedene Angaben", tone: "red" }
    : labelOf(FAMILY_IMPORT_STATUS, row.status, { label: "–", tone: "gray" });
}

/** Der Name des Kindes, „–“ ohne Namen. */
export function familyImportChild(row: FamilyImportRow): string {
  const name = `${row.childFirstName} ${row.childLastName}`.trim();
  return name === "" ? "–" : name;
}

const MISSING_TEXT: Record<FamilyImportField, string> = {
  child_first_name: "Der Vorname des Kindes fehlt.",
  child_last_name: "Der Nachname des Kindes fehlt.",
  child_birth_date: "Das Geburtsdatum fehlt.",
  school: "Die Schule fehlt.",
  children: "Die Kinderzahl fehlt.",
  valid_from: "Der Tag in „Gültig ab“ fehlt.",
};

const INVALID_TEXT: Partial<Record<FamilyImportField, string>> = {
  child_birth_date: "Das Geburtsdatum ist kein Datum. Beispiel: 03.05.2018.",
  children: "Die Kinderzahl ist keine ganze Zahl von 1 bis 20.",
  valid_from: "„Gültig ab“ ist kein Datum. Beispiel: 01.09.2026.",
};

/** Was eine Zeile aufhält, als ein Satz ohne den Wert aus der Datei. */
export function familyImportProblemText(
  problem: FamilyImportRow["problems"][number],
  row: FamilyImportRow,
): string {
  const { field } = problem;
  if (field === undefined) return "Ein Feld dieser Zeile prüfen.";
  const label = FAMILY_IMPORT_FIELD_LABELS[field] ?? field;
  switch (problem.code) {
    case "missing":
      return MISSING_TEXT[field] ?? `${label} fehlt.`;
    case "invalid":
      return INVALID_TEXT[field] ?? `${label} prüfen.`;
    case "too_long":
      return `${label} ist zu lang.`;
    case "unknown":
      return "Diese Schule gehört nicht zu deinem Träger.";
    case "ambiguous":
      return problem.field === "school"
        ? "Mehrere Schulen heißen so. Bitte eine Schule für die Datei wählen."
        : "Mehrere Kinder der Schule heißen so. Ergänze das Geburtsdatum in der Datei.";
    case "no_contract":
      return "moto findet an dieser Schule keinen Vertrag für das Kind. Prüfe Name und Schule.";
    case "repeated":
      return row.repeatsLine === null
        ? "Das Kind steht mehrmals in der Datei."
        : `Das Kind steht schon in Zeile ${row.repeatsLine}.`;
    case "rows_differ":
      return "Geschwister derselben Familie nennen verschiedene Zahlen. moto übernimmt keine.";
    case "too_far_ahead":
      return "Der Tag liegt mehr als neun Monate voraus. Trage die Zahl später nach.";
    case "contract_ended":
      return "Der Vertrag des Kindes endet, bevor die neue Kinderzahl gelten kann. moto übernimmt die Zahl nicht.";
    case "confirmations_differ":
      return "Für diese Familie sind verschiedene Kinderzahlen bestätigt. Bestätige die Kinderzahl in der Familienliste.";
    default:
      return `${label} prüfen.`;
  }
}

/** Was mit einer Zeile ohne Fehler geschieht, als ein Satz. */
export function familyImportOutcomeText(row: FamilyImportRow): string | null {
  switch (row.status) {
    case "same":
      return "Diese Zahl ist für die Familie schon bestätigt.";
    case "differs":
      return `Bestätigt ${row.confirmedChildren === 1 ? "ist" : "sind"} ${childrenLabel(row.confirmedChildren ?? 0)}. moto ändert die Zahl nicht. Ändere sie in der Liste.`;
    default:
      return null;
  }
}

/** Rows the import leaves out: wrong, contradicting, or another number confirmed. */
export function familyImportOpenRows(
  counts: Pick<
    FamilyImportResult["counts"],
    "conflict" | "invalid" | "differs"
  >,
): number {
  return counts.conflict + counts.invalid + counts.differs;
}

export type FamilyImportFilter = "all" | "ready" | "problems" | "unchanged";

/** Ob eine Zeile zum gewählten Filter gehört. */
export function matchesFamilyImportFilter(
  row: FamilyImportRow,
  filter: FamilyImportFilter,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "ready":
      return row.status === "ready" || row.status === "imported";
    case "problems":
      return (
        row.status === "conflict" ||
        row.status === "invalid" ||
        row.status === "differs"
      );
    default:
      return row.status === "same";
  }
}

/** „1 Kinderzahl“, „12 Kinderzahlen“. */
export function numberCountLabel(count: number): string {
  return count === 1 ? "1 Kinderzahl" : `${count} Kinderzahlen`;
}

/** Eine Beispieldatei mit den Spalten, die moto von selbst erkennt. */
export const FAMILY_IMPORT_SAMPLE = [
  "Vorname;Nachname;Geburtsdatum;Schule;Kinder in der Familie;Kinderzahl gilt ab",
  "Mia;Beispiel;03.05.2018;Grundschule Nord;2;01.09.2026",
  "Ben;Muster;11.11.2019;Grundschule Nord;1;",
].join("\r\n");
