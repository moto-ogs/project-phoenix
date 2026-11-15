// Texte und Einteilungen des Personal-Imports (#4724): Feldnamen, der Stand
// einer Zeile, die Gründe, warum eine Zeile draußen bleibt, und die
// Beispieldatei. Kein Text wiederholt einen Wert der Datei außer dem, was die
// Zeile ohnehin zeigt.

import type { StatusBadgeTone } from "~/components/ui/status-badge";
import type {
  StaffImportCounts,
  StaffImportField,
  StaffImportProblem,
  StaffImportRow,
  StaffImportRowStatus,
} from "~/lib/traeger-staff-import-api";

/** Felder in der Reihenfolge der Zuordnung. */
export const STAFF_IMPORT_FIELDS: readonly StaffImportField[] = [
  "personnel_number",
  "first_name",
  "last_name",
  "birthday",
  "iban",
  "tax_id",
  "social_security_number",
];

export const REQUIRED_STAFF_IMPORT_FIELDS: ReadonlySet<StaffImportField> =
  new Set(["personnel_number", "first_name", "last_name"]);

export const STAFF_IMPORT_FIELD_LABELS: Record<StaffImportField, string> = {
  personnel_number: "Personalnummer",
  first_name: "Vorname",
  last_name: "Nachname",
  birthday: "Geburtsdatum",
  iban: "IBAN",
  tax_id: "Steuer-ID",
  social_security_number: "SV-Nummer",
};

export const STAFF_IMPORT_FIELD_HINTS: Record<StaffImportField, string> = {
  personnel_number:
    "Die Nummer aus Ihrem Lohnprogramm. Daran erkennt moto die Person wieder.",
  first_name: "Der Vorname der Person.",
  last_name: "Der Nachname der Person.",
  birthday: "Zum Beispiel 02.04.1990.",
  iban: "Für die Lohnzahlung. moto zeigt sie nur verdeckt.",
  tax_id: "Die 11-stellige Steuer-Identifikationsnummer.",
  social_security_number: "Die Sozialversicherungsnummer.",
};

export const STAFF_IMPORT_STATUS: Record<
  StaffImportRowStatus,
  { label: string; tone: StatusBadgeTone }
> = {
  new: { label: "Neue Akte", tone: "green" },
  complete: { label: "Ergänzt Akte", tone: "blue" },
  duplicate: { label: "Schon vorhanden", tone: "gray" },
  conflict: { label: "Passt nicht", tone: "warning" },
  invalid: { label: "Fehler", tone: "red" },
  imported: { label: "Übernommen", tone: "green" },
};

export type StaffImportFilter = "all" | "takes" | "skipped" | "problems";

export function matchesStaffImportFilter(
  row: StaffImportRow,
  filter: StaffImportFilter,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "takes":
      return (
        row.status === "new" ||
        row.status === "complete" ||
        row.status === "imported"
      );
    case "skipped":
      return row.status === "duplicate";
    case "problems":
      return row.status === "conflict" || row.status === "invalid";
  }
}

/** Zeilen, die moto beim Übernehmen anlegt oder ergänzt. */
export function staffImportTakes(counts: StaffImportCounts): number {
  return counts.new + counts.complete;
}

export function staffImportRowsLabel(count: number): string {
  return count === 1 ? "1 Zeile" : `${count} Zeilen`;
}

/** Was ein Import angelegt und ergänzt hat, als kurzer Satz. */
export function staffImportDoneTitle(rows: readonly StaffImportRow[]): string {
  const imported = rows.filter((row) => row.status === "imported");
  const completed = imported.filter((row) => row.completes.length > 0).length;
  const created = imported.length - completed;
  const parts = [
    created === 1 ? "1 neue Akte" : `${created} neue Akten`,
    ...(completed > 0 ? [`${completed} ergänzt`] : []),
  ];
  return parts.join(", ");
}

/** Was nach dem Import offen bleibt. */
export function staffImportDoneDescription(counts: StaffImportCounts): string {
  const open = counts.conflict + counts.invalid;
  const sentences = [
    counts.duplicate > 0
      ? `${staffImportRowsLabel(counts.duplicate)} ${counts.duplicate === 1 ? "war" : "waren"} schon vorhanden.`
      : "",
    open > 0
      ? `${staffImportRowsLabel(open)} ${open === 1 ? "blieb" : "blieben"} draußen. Korrigieren Sie sie in der Datei und laden Sie die Datei noch einmal.`
      : "",
    "Unter „Vorschläge“ zeigt moto, welches Personal der Schulen zu den neuen Akten passt.",
  ];
  return sentences.filter(Boolean).join(" ");
}

/** Der Grund, warum eine Zeile draußen bleibt, ohne einen Wert zu nennen. */
export function staffImportProblemText(problem: StaffImportProblem): string {
  const field = STAFF_IMPORT_FIELD_LABELS[problem.field];
  switch (problem.code) {
    case "missing":
      return `${field} fehlt.`;
    case "invalid":
      return problem.field === "personnel_number"
        ? "Die Personalnummer darf nur Ziffern haben, höchstens 9."
        : `${field} ist so nicht gültig.`;
    case "too_long":
      return `${field} ist zu lang.`;
    case "future":
      return "Das Geburtsdatum liegt in der Zukunft.";
    case "repeated":
      return "Die Personalnummer steht mehrmals in der Datei.";
    case "differs":
      return `${field} weicht von der Akte ab.`;
  }
}

/** Der Hinweis einer Zeile, die moto übernimmt oder überspringt. */
export function staffImportStatusNote(row: StaffImportRow): string | null {
  if (row.status === "duplicate") return "Die Akte hat schon diese Werte.";
  if (row.completes.length === 0) return null;
  const fields = row.completes.map((field) => STAFF_IMPORT_FIELD_LABELS[field]);
  return `Trägt ${joinGerman(fields)} in die Akte ein.`;
}

function joinGerman(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} und ${items.at(-1)}`;
}

/** Beispieldatei mit Überschriften, die moto von selbst zuordnet. */
export const STAFF_IMPORT_TEMPLATE =
  "Personalnummer;Vorname;Nachname;Geburtsdatum;IBAN;Steuer-ID;SV-Nummer\r\n" +
  "70031;Mira;Sommer;02.04.1990;DE89370400440532013000;12345678901;65170839J003\r\n";

export const STAFF_IMPORT_TEMPLATE_NAME = "personal-vorlage.csv";
