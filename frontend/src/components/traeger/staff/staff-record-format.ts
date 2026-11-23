/**
 * Wörter und Werte der Personalakten des Trägers (#4705): Feldnamen,
 * Gründe der Vorschläge und die Anzeige der Einträge im Verlauf.
 */
import type { StatusBadgeTone } from "~/components/ui/status-badge";
import { formatDate } from "~/lib/date-helpers";
import type {
  StaffChange,
  StaffMatchReason,
  StaffRecordField,
} from "~/lib/traeger-staff-api";

export const STAFF_FIELD_LABELS: Readonly<Record<StaffRecordField, string>> = {
  first_name: "Vorname",
  last_name: "Nachname",
  birthday: "Geburtstag",
  personnel_number: "Personalnummer",
  iban: "IBAN",
  tax_id: "Steuer-ID",
  social_security_number: "Sozialversicherungsnummer",
};

/** Warum moto Beschäftigungen zusammen vorschlägt, in einem Wort. */
export const STAFF_MATCH_LABELS: Readonly<Record<StaffMatchReason, string>> = {
  same_account: "Gleiches Konto",
  same_personnel_number: "Gleiche Personalnummer",
  same_name_birthday: "Gleicher Name und Geburtstag",
  single: "Eine Schule",
};

export const STAFF_MATCH_TONES: Readonly<
  Record<StaffMatchReason, StatusBadgeTone>
> = {
  same_account: "green",
  same_personnel_number: "blue",
  same_name_birthday: "orange",
  single: "gray",
};

/** Ein Feldwert für die Anzeige; ein Geburtstag als deutsches Datum. */
export function staffFieldValue(
  field: StaffRecordField,
  value: string,
): string {
  if (!value) return "–";
  return field === "birthday" ? formatDate(value) : value;
}

/** Ein Eintrag zu einem Arbeitsvertrag im Verlauf (#4706). */
function contractChangeText(change: StaffChange): string {
  const school = change.schoolName || "einer Schule";
  switch (change.field) {
    case "contract_soll":
      return `Soll an der Schule ${school} geändert: ${change.value}`;
    case "holiday_week":
      return change.kind === "removed"
        ? `Ferien-Soll an der Schule ${school} gelöscht: ${change.value}`
        : `Ferien-Soll an der Schule ${school} eingetragen: ${change.value}`;
    default:
      if (change.kind === "added")
        return `Arbeitsvertrag angelegt: ${change.value}`;
      if (change.kind === "removed")
        return `Arbeitsvertrag gelöscht: ${change.value}`;
      return `Arbeitsvertrag geändert, vorher: ${change.value}`;
  }
}

/**
 * Ein Eintrag des Personal-Imports (#4724). Der Wert lautet
 * „Zeile <n>: <Datei>“; er nennt nie den importierten Wert.
 */
function importedChangeText(change: StaffChange): string {
  const match = /^Zeile (\d+): (.*)$/.exec(change.value);
  const source = match ? `${match[2]}, Zeile ${match[1]}` : change.value;
  if (
    change.field === "iban" ||
    change.field === "tax_id" ||
    change.field === "social_security_number"
  ) {
    return `${STAFF_FIELD_LABELS[change.field]} aus Datei eingetragen (${source})`;
  }
  return `Aus Datei angelegt (${source})`;
}

/** Ein Eintrag im Verlauf als ein Satz. */
export function staffChangeText(change: StaffChange): string {
  // An entry this build cannot read says nothing it cannot back up.
  if (change.kind === undefined || change.field === undefined) return "–";
  const school = change.schoolName || "einer Schule";
  if (
    change.field === "contract" ||
    change.field === "contract_soll" ||
    change.field === "holiday_week"
  ) {
    return contractChangeText(change);
  }
  if (change.kind === "linked") {
    return `Beschäftigung an der Schule ${school} verknüpft`;
  }
  if (change.kind === "ended") {
    return `Beschäftigung an der Schule ${school} nach der letzten Blockung beendet`;
  }
  if (change.kind === "resumed") {
    return `Beschäftigung an der Schule ${school} mit einer neuen Blockung wieder aufgenommen`;
  }
  if (change.kind === "imported" || change.field === "record") {
    return importedChangeText(change);
  }
  const field =
    change.field === "school" ? "Schule" : STAFF_FIELD_LABELS[change.field];
  const value =
    change.field === "school"
      ? change.value
      : staffFieldValue(change.field, change.value);
  if (change.kind === "not_chosen") {
    return `${field} „${value}“ von ${school} nicht übernommen`;
  }
  if (change.kind === "removed") {
    return `${field} entfernt, vorher „${value}“`;
  }
  return value === "–"
    ? `${field} eingetragen`
    : `${field} ersetzt, vorher „${value}“`;
}

/** Wie viele Schulen, als Wort. */
export function schoolCount(count: number): string {
  return count === 1 ? "1 Schule" : `${count} Schulen`;
}
