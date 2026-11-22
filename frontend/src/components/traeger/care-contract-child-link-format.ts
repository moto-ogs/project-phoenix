// Texte und Zustände der Verknüpfung importierter Verträge mit der
// Kinderakte (#7760, ADR 0307): die zwei Spalten der Datei, der Stand einer
// Zeile und was sie aufhält, in den Worten des Träger-Büros. Reine Anzeige;
// jede Prüfung macht das Backend.

import type { StatusBadgeTone } from "~/components/ui/status-badge";
import { formatDate } from "~/lib/date-helpers";
import type {
  ChildLinkCounts,
  ChildLinkField,
  ChildLinkPerson,
  ChildLinkProblem,
  ChildLinkResult,
  ChildLinkRow,
  ChildLinkStatus,
} from "~/lib/traeger-contract-child-links-api";

export const CHILD_LINK_FIELD_LABELS: Record<ChildLinkField, string> = {
  contract: "Vertragsnummer",
  child: "Nummer der Kinderakte",
};

export const CHILD_LINK_STATUS: Record<
  ChildLinkStatus,
  { readonly label: string; readonly tone: StatusBadgeTone }
> = {
  ready: { label: "Bereit", tone: "green" },
  stored: { label: "Verknüpft", tone: "green" },
  linked: { label: "Schon verknüpft", tone: "gray" },
  conflict: { label: "Unklar", tone: "warning" },
  invalid: { label: "Nicht möglich", tone: "red" },
};

/** Der Name, „–“ ohne Namen. */
export function childLinkName(person: ChildLinkPerson): string {
  const name = `${person.firstName} ${person.lastName}`.trim();
  return name === "" ? "–" : name;
}

/** „geb. 03.05.2018“ oder „ohne Geburtsdatum“. */
export function childLinkBirth(person: ChildLinkPerson): string {
  return person.birthDate
    ? `geb. ${formatDate(person.birthDate)}`
    : "ohne Geburtsdatum";
}

/** Vergleicht Namen wie das Backend: ohne Groß- und Kleinschreibung und doppelte Leerzeichen. */
function foldName(person: ChildLinkPerson): string {
  return [person.firstName, person.lastName]
    .map((part) => part.trim().split(/\s+/).join(" ").toLowerCase())
    .join("\u001f");
}

/** Was an der Kinderakte anders ist als im Vertrag. */
export interface ChildLinkDifference {
  readonly name: boolean;
  readonly birthDate: boolean;
}

/**
 * Name und Geburtsdatum der Kinderakte gegen den Vertrag, wie das Backend
 * sie vergleicht: Ein fehlendes Geburtsdatum widerspricht nicht.
 */
export function childLinkDifference(
  contract: ChildLinkPerson,
  student: ChildLinkPerson | null,
): ChildLinkDifference {
  if (!student) return { name: false, birthDate: false };
  return {
    name: foldName(contract) !== foldName(student),
    birthDate:
      contract.birthDate !== null &&
      student.birthDate !== null &&
      contract.birthDate !== student.birthDate,
  };
}

/** „Name und Geburtsdatum“, „Name“ oder „Geburtsdatum“ für den Hinweis. */
export function childLinkDifferenceText(
  difference: ChildLinkDifference,
): string {
  if (difference.name && difference.birthDate) {
    return "Name und Geburtsdatum weichen ab";
  }
  if (difference.birthDate) return "Geburtsdatum weicht ab";
  return "Name weicht ab";
}

/** Was abweicht, als Satz für die Vorschau. */
function differsSubject(difference: ChildLinkDifference): string {
  if (difference.name && difference.birthDate) {
    return "Name und Geburtsdatum in der Kinderakte sind anders als im Vertrag.";
  }
  if (difference.birthDate) {
    return "Das Geburtsdatum in der Kinderakte ist anders als im Vertrag.";
  }
  return "Der Name in der Kinderakte ist anders als im Vertrag.";
}

function problemText(problem: ChildLinkProblem, row: ChildLinkRow): string {
  const child = problem.field === "child";
  switch (problem.code) {
    case "missing":
      return child
        ? "In der Zeile fehlt die Nummer der Kinderakte. Trage sie in der Datei nach."
        : "In der Zeile fehlt die Vertragsnummer. Trage sie in der Datei nach.";
    case "invalid":
      return child
        ? "Die Nummer der Kinderakte ist keine ganze Zahl. Prüfe die Zeile in der Datei."
        : "Die Vertragsnummer ist keine ganze Zahl. Prüfe die Zeile in der Datei.";
    case "unknown":
      return child
        ? "Die Schule des Vertrags hat keine Kinderakte mit dieser Nummer. Prüfe die Nummer."
        : "Einen Vertrag mit dieser Nummer gibt es bei deinem Träger nicht. Prüfe die Nummer.";
    case "not_imported":
      return "Das ist kein importierter Vertrag. Ein Vertrag aus einer Anmeldung gehört schon zu seinem Kind.";
    case "repeated": {
      const where =
        row.repeatsLine === null
          ? "auch in einer anderen Zeile"
          : `auch in Zeile ${row.repeatsLine}`;
      return child
        ? `Diese Kinderakte steht ${where}, für einen Vertrag derselben Zeit. Behalte nur die Zeile, die stimmt.`
        : `Dieser Vertrag steht ${where}. Behalte nur die Zeile, die stimmt.`;
    }
    case "linked_other":
      return "Der Vertrag ist schon mit einer anderen Kinderakte verknüpft. Prüfe das auf der Seite des Vertrags.";
    case "has_contract":
      return row.otherContractId === null
        ? "Das Kind hat in dieser Zeit schon einen anderen laufenden Vertrag an der Schule. Prüfe beide Verträge."
        : `Das Kind hat in dieser Zeit schon einen anderen laufenden Vertrag an der Schule (Nr. ${row.otherContractId}). Prüfe beide Verträge.`;
    case "differs":
      return `${differsSubject(childLinkDifference(row.contract, row.student))} Ist es dasselbe Kind, verknüpfe den Vertrag einzeln auf seiner Seite.`;
    default:
      return "moto kann diese Zeile nicht verknüpfen. Prüfe beide Nummern.";
  }
}

/** Warum die Zeile so steht und was zu tun ist, je ein Satz. */
export function childLinkRowTexts(row: ChildLinkRow): string[] {
  if (row.problems.length > 0) {
    return row.problems.map((problem) => problemText(problem, row));
  }
  switch (row.status) {
    case "ready":
      return ["Passt. moto verknüpft den Vertrag mit dieser Kinderakte."];
    case "stored":
      return ["Jetzt mit dieser Kinderakte verknüpft."];
    case "linked":
      return ["Der Vertrag ist schon mit dieser Kinderakte verknüpft."];
    default:
      return [];
  }
}

/**
 * Was die Verknüpfung eines einzelnen Vertrags aufhält, ohne Sprache der
 * Datei. `null`: nichts, oder nur eine Abweichung, die das Büro bestätigen
 * kann.
 */
export function childLinkSingleBlock(row: ChildLinkRow): string | null {
  const blocking = row.problems.filter((problem) => problem.code !== "differs");
  const first = blocking[0];
  if (!first) return null;
  switch (first.code) {
    case "has_contract":
      return row.otherContractId === null
        ? "Das Kind hat in dieser Zeit schon einen anderen laufenden Vertrag an der Schule. Prüfe zuerst beide Verträge."
        : `Das Kind hat in dieser Zeit schon einen anderen laufenden Vertrag an der Schule (Nr. ${row.otherContractId}). Prüfe zuerst beide Verträge.`;
    case "linked_other":
      return "Der Vertrag ist schon mit einer anderen Kinderakte verknüpft. Löse zuerst diese Verknüpfung.";
    case "not_imported":
      return "Hier lassen sich nur importierte Verträge verknüpfen. Ein Vertrag aus einer Anmeldung gehört schon zu seinem Kind.";
    case "unknown":
      return first.field === "child"
        ? "Die Schule des Vertrags hat keine Kinderakte mit dieser Nummer. Prüfe die Nummer."
        : "Diesen Vertrag gibt es bei deinem Träger nicht.";
    case "missing":
    case "invalid":
      return "Gib die Nummer der Kinderakte als ganze Zahl ein.";
    default:
      return "moto kann den Vertrag nicht mit dieser Kinderakte verknüpfen. Prüfe die Nummer.";
  }
}

export type ChildLinkFilter =
  "all" | "ready" | "linked" | "conflict" | "invalid";

/** Ob eine Zeile zum gewählten Filter gehört. */
export function matchesChildLinkFilter(
  row: ChildLinkRow,
  filter: ChildLinkFilter,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "ready":
      return row.status === "ready" || row.status === "stored";
    default:
      return row.status === filter;
  }
}

/**
 * Der Filter, mit dem die Vorschau öffnet: zuerst die Zeilen, die Arbeit
 * machen (unklar, dann nicht gefunden), sonst alle.
 */
export function defaultChildLinkFilter(
  counts: ChildLinkCounts,
): ChildLinkFilter {
  if (counts.conflict > 0) return "conflict";
  if (counts.invalid > 0) return "invalid";
  return "all";
}

/** Zeilen, die nach dem Lauf offen bleiben: unklar oder nicht gefunden. */
export function openChildLinkRows(
  result: ChildLinkResult,
): readonly ChildLinkRow[] {
  return result.rows.filter(
    (row) =>
      (row.status === "conflict" || row.status === "invalid") &&
      !isSettledRow(row),
  );
}

/** „1 Vertrag“, „12 Verträge“. */
export function childLinkContractCount(count: number): string {
  return count === 1 ? "1 Vertrag" : `${count} Verträge`;
}

/** Eine Beispieldatei mit den Spalten, die moto von selbst erkennt. */
export const CHILD_LINK_SAMPLE = [
  "Vertrag Nr.;Kinderakte",
  "1001;5012",
  "1002;5013",
].join("\r\n");

/**
 * Eine Zelle der Arbeitsliste. Ein Name, der (auch nach Leerzeichen) mit =, +, - oder @ beginnt,
 * bekommt ein Hochkomma davor, damit Excel ihn nicht als Formel liest.
 */
function csvCell(value: string): string {
  const safe = /^\s*[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[";\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/**
 * Die offenen Zeilen als CSV-Datei, als Arbeitsliste für das Büro: Zeile,
 * beide Nummern, beide Kinder, Schule und was zu tun ist.
 */
export function openChildLinkRowsCsv(rows: readonly ChildLinkRow[]): string {
  const header = [
    "Zeile",
    "Vertragsnummer",
    "Nummer der Kinderakte",
    "Kind im Vertrag",
    "Kind in der Kinderakte",
    "Schule",
    "Was zu tun ist",
  ];
  const lines = rows.map((row) =>
    [
      String(row.line),
      row.contractId ?? "",
      row.studentId ?? "",
      row.contract.firstName || row.contract.lastName
        ? `${childLinkName(row.contract)} (${childLinkBirth(row.contract)})`
        : "",
      row.student
        ? `${childLinkName(row.student)} (${childLinkBirth(row.student)})`
        : "",
      row.schoolName,
      childLinkRowTexts(row).join(" "),
    ]
      .map(csvCell)
      .join(";"),
  );
  return [header.join(";"), ...lines].join("\r\n");
}

/**
 * A row of a contract from an application: it belongs to its child already,
 * so there is nothing to link and nothing open.
 */
export function isSettledRow(row: ChildLinkRow): boolean {
  return row.problems.some((problem) => problem.code === "not_imported");
}

/** The rows the office still has to look at: unclear or not possible. */
export function openRowCount(result: ChildLinkResult): number {
  return (
    result.counts.conflict +
    result.counts.invalid -
    result.rows.filter(isSettledRow).length
  );
}
