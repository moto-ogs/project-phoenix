// Die Familien der Verträge ohne Mail-Adresse (#7161, ADR 0319): moto kennt
// diese Verträge nur einzeln, jeder ist eine eigene Familie. Das Träger-Büro
// führt Geschwister unter einem führenden Vertrag zusammen. Hier entstehen
// aus den Verträgen die Familien der Seite und die Texte ihres Verlaufs.

import type {
  ContractFamilyEvent,
  ContractFamilyMember,
} from "~/lib/traeger-contract-families-api";

/** Eine Familie: der führende Vertrag und die Verträge, die er führt. */
export interface ContractFamily {
  /** Der führende Vertrag; zugleich der Schlüssel der Familie. */
  readonly leadId: string;
  readonly lead: ContractFamilyMember;
  /** Alle Kinder der Familie, der führende Vertrag zuerst. */
  readonly members: readonly ContractFamilyMember[];
}

export function childName(
  contract: Pick<ContractFamilyMember, "childFirstName" | "childLastName">,
): string {
  return `${contract.childFirstName} ${contract.childLastName}`.trim();
}

const collator = new Intl.Collator("de", { sensitivity: "base" });

function byChild(a: ContractFamilyMember, b: ContractFamilyMember): number {
  return (
    collator.compare(a.childLastName, b.childLastName) ||
    collator.compare(a.childFirstName, b.childFirstName) ||
    collator.compare(a.contractId, b.contractId)
  );
}

/**
 * Bildet die Familien aus den Verträgen, sortiert nach dem Nachnamen des
 * führenden Kindes. So stehen Geschwister mit demselben Nachnamen
 * untereinander. Ein Vertrag, dessen führender Vertrag nicht in der Liste
 * steht, führt seine Familie selbst.
 */
export function contractFamilies(
  contracts: readonly ContractFamilyMember[],
): ContractFamily[] {
  const ids = new Set(contracts.map((contract) => contract.contractId));
  const groups = new Map<string, ContractFamilyMember[]>();
  for (const contract of contracts) {
    const leadId = ids.has(contract.familyContractId)
      ? contract.familyContractId
      : contract.contractId;
    const group = groups.get(leadId) ?? [];
    group.push(contract);
    groups.set(leadId, group);
  }
  const families: ContractFamily[] = [];
  for (const [leadId, group] of groups) {
    const lead = group.find((contract) => contract.contractId === leadId);
    if (!lead) continue;
    const others = group
      .filter((contract) => contract.contractId !== leadId)
      .sort(byChild);
    families.push({ leadId, lead, members: [lead, ...others] });
  }
  return families.sort((a, b) => byChild(a.lead, b.lead));
}

/** Ob die Familie mehr als ein Kind hat. */
export function isJoined(family: ContractFamily): boolean {
  return family.members.length > 1;
}

/** Wer die Eltern der Familie sind; „–“ ohne Angabe. */
export function familyParents(family: ContractFamily): string {
  const names = [
    ...new Set(
      family.members.map((contract) => contract.partyName).filter(Boolean),
    ),
  ];
  return names.length > 0 ? names.join(", ") : "–";
}

/** Die Schulen der Kinder, jede einmal. */
export function familySchools(family: ContractFamily): string {
  return [
    ...new Set(family.members.map((contract) => contract.schoolName)),
  ].join(", ");
}

/** Was die Suche durchsucht: Kinder, Eltern und Vertragsnummern. */
export function familyMatches(family: ContractFamily, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return family.members.some((contract) =>
    [childName(contract), contract.partyName, contract.contractId].some(
      (value) => value.toLowerCase().includes(needle),
    ),
  );
}

export function childrenLabel(count: number): string {
  return count === 1 ? "1 Kind" : `${count} Kinder`;
}

export function familiesLabel(count: number): string {
  return count === 1 ? "1 Familie" : `${count} Familien`;
}

/**
 * Der führende Vertrag, den die Auswahl vorschlägt: eine Familie mit
 * Geschwistern behält ihren, sonst führt das erste Kind der Liste.
 */
export function proposedLead(families: readonly ContractFamily[]): string {
  return (families.find(isJoined) ?? families[0])?.leadId ?? "";
}

/** Ein Eintrag des Verlaufs in einem Satz. */
export function familyEventText(
  event: ContractFamilyEvent,
  names: ReadonlyMap<string, string>,
): string {
  const child = childName(event) || `Vertrag Nr. ${event.contractId}`;
  const familyOf = (contractId: string) =>
    names.get(contractId) ?? `Vertrag Nr. ${contractId}`;
  if (event.action === "leave_family") {
    return `${child} aus der Familie von ${familyOf(event.previousFamilyContractId)} gelöst`;
  }
  if (event.familyContractId === event.contractId) {
    return `${child} führt jetzt die Familie`;
  }
  return `${child} zur Familie von ${familyOf(event.familyContractId)}`;
}
