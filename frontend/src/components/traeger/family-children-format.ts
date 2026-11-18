/** Display helpers of the children of the families (#5918). */

import type { StatusBadgeTone } from "~/components/ui/status-badge";
import { formatDate } from "~/lib/date-helpers";
import type {
  FamilyChildCount,
  FamilyChildren,
  FamilyChildrenStatus,
} from "~/lib/traeger-family-children-api";

/** States the Abrechnung has to look at. */
export const NEEDS_CHECK: readonly FamilyChildrenStatus[] = [
  "stated",
  "changed",
  "expired",
  "expiring",
  "differing",
];

export const STATUS_LABELS: Record<FamilyChildrenStatus, string> = {
  missing: "Keine Angabe",
  stated: "Neu von Eltern",
  changed: "Eltern melden Änderung",
  confirmed: "Bestätigt",
  expiring: "Läuft bald ab",
  expired: "Abgelaufen",
  upcoming: "Gilt später",
  differing: "Verschiedene Angaben",
};

export const STATUS_TONES: Record<FamilyChildrenStatus, StatusBadgeTone> = {
  missing: "gray",
  stated: "warning",
  changed: "warning",
  confirmed: "green",
  expiring: "warning",
  // An expired number no longer counts for the price: red, it needs a check.
  expired: "red",
  upcoming: "blue",
  differing: "warning",
};

/** "1 Kind", "3 Kinder". */
export function childrenLabel(count: number): string {
  return count === 1 ? "1 Kind" : `${count} Kinder`;
}

/**
 * The name of the recipient of the family's invoices, else its address. A
 * family without both, such as an imported contract without parents, is
 * named by its child: „Familie von Mia Beispiel“ (#7356).
 */
export function familyName(family: FamilyChildren): string {
  const name =
    `${family.recipientFirstName} ${family.recipientLastName}`.trim();
  if (name) return name;
  if (family.recipientEmail) return family.recipientEmail;
  const child = family.children[0];
  return child
    ? `Familie von ${child.childFirstName} ${child.childLastName}`.trim()
    : `Vertrag Nr. ${family.contractId}`;
}

/**
 * What tells the family apart under its name: its mail address, and for a
 * family moto knows only by its contract the number of that contract.
 */
export function familyAddress(family: FamilyChildren): string {
  return (
    family.recipientEmail || `Vertrag Nr. ${family.contractId} · ohne E-Mail`
  );
}

/** A stable key of the family in a list. */
export function familyKey(family: FamilyChildren): string {
  return family.recipientEmail || `contract:${family.contractId}`;
}

/** "ab 01.09.2026" or "01.09.2026 bis 31.07.2027". */
export function validityLabel(count: FamilyChildCount): string {
  if (!count.validFrom) return "";
  return count.validUntil
    ? `${formatDate(count.validFrom)} bis ${formatDate(count.validUntil)}`
    : `ab ${formatDate(count.validFrom)}`;
}

/** The calendar day of an instant the parents stated their number on. */
export function statedOn(count: FamilyChildCount): string {
  return count.statedAt ? formatDate(count.statedAt) : "";
}

/** What the Abrechnung has to check, in one short line. */
export function checkReason(family: FamilyChildren, today: string): string {
  if (family.status === "differing") {
    return "Die Verträge der Familie nennen verschiedene Kinderzahlen. Bis du eine bestätigst, zählen nur die Kinder mit Vertrag.";
  }
  const count = family.count;
  if (!count) return "";
  // A later confirmation is stored as the current one: the state then
  // belongs to the earlier confirmation, whose end the page does not know.
  const later =
    count.validFrom !== null && count.validFrom > today
      ? formatDate(count.validFrom)
      : null;
  if (later && family.status === "expired") {
    return `Die bisherige Kinderzahl ist abgelaufen. Die neue gilt erst ab ${later}.`;
  }
  if (later && family.status === "expiring") {
    return `Die bisherige Kinderzahl läuft bald ab. Die neue gilt erst ab ${later}.`;
  }
  switch (family.status) {
    case "stated":
      return `Eltern geben ${childrenLabel(count.statedChildren ?? 0)} an (am ${statedOn(count)}).`;
    case "changed":
      return `Eltern geben jetzt ${childrenLabel(count.statedChildren ?? 0)} an. Bestätigt sind ${childrenLabel(count.confirmedChildren ?? 0)}.`;
    case "expired":
      return `Die Kinderzahl galt bis ${formatDate(count.validUntil ?? "")}. Bitte neu prüfen.`;
    case "expiring":
      return `Die Kinderzahl gilt nur bis ${formatDate(count.validUntil ?? "")}.`;
    default:
      return "";
  }
}
