import { bffJson } from "~/lib/bff-fetch";
/**
 * Client of the responsibilities at the schools of a Träger (#4811): who
 * concludes the care contracts, bills the parents and employs the staff at
 * each school (Träger, Schulträger or Gemeinde), and the master data of a
 * school's Schulträger and Gemeinde. The choice itself is a setting
 * (`responsibility.*`): the Träger value is saved through the Träger
 * settings, a school's own value in the school's settings.
 * Backend int64 IDs leave here as strings.
 */

import { knownEnum } from "./contract/known-enum";
import type * as contract from "./contract/traeger-master-data.generated";
import { RESPONSIBILITY_SETTINGS_TAB } from "./traeger-responsibility-tab";

// The closed sets of the contract, kept here as plain lists: importing the
// generated values would pull the whole master data contract with its
// decoders into every page that shows a responsibility (bundle ratchet).
// The `satisfies` lines fail the build when Go renames or drops a value.
const RESPONSIBLE_BODY_VALUES = [
  "traeger",
  "schultraeger",
  "gemeinde",
] as const satisfies readonly contract.ResponsibleBody[];
const SCHOOL_PARTY_KIND_VALUES = [
  "schultraeger",
  "gemeinde",
] as const satisfies readonly contract.SchoolPartyKind[];
const RESPONSIBILITY_AREA_VALUES = [
  "contracts",
  "billing",
  "staff",
] as const satisfies readonly contract.ResponsibilityArea[];
const RESPONSIBILITY_SOURCE_VALUES = [
  "default",
  "traeger",
  "school",
] as const satisfies readonly contract.ResponsibilitySource[];

export type ResponsibleBody = (typeof RESPONSIBLE_BODY_VALUES)[number];
export type SchoolPartyKind = (typeof SCHOOL_PARTY_KIND_VALUES)[number];
export type ResponsibilityArea = (typeof RESPONSIBILITY_AREA_VALUES)[number];
type ResponsibilitySource = (typeof RESPONSIBILITY_SOURCE_VALUES)[number];

export { RESPONSIBILITY_SETTINGS_TAB };

/** The areas in the order every screen lists them. */
export const RESPONSIBILITY_AREAS: readonly ResponsibilityArea[] = [
  "contracts",
  "billing",
  "staff",
];

/** The bodies that keep master data per school, in display order. */
export const SCHOOL_PARTY_KINDS: readonly SchoolPartyKind[] = [
  "schultraeger",
  "gemeinde",
];

export const RESPONSIBLE_BODY_LABELS: Record<ResponsibleBody, string> = {
  traeger: "Träger",
  schultraeger: "Schulträger",
  gemeinde: "Gemeinde",
};

export const RESPONSIBILITY_AREA_LABELS: Record<ResponsibilityArea, string> = {
  contracts: "Verträge",
  billing: "Abrechnung",
  staff: "Personal",
};

/** What the responsible body does today, one sentence per area. */
export const RESPONSIBILITY_AREA_EFFECTS: Record<ResponsibilityArea, string> = {
  contracts:
    "Steht in neuen Betreuungsverträgen als Absender und, wenn die Vertragsbedingungen keinen nennen, als Vertragspartner.",
  billing:
    "Stellt neue Rechnungen und Bescheide aus und zieht Lastschriften mit eigener Gläubiger-ID ein.",
  staff: "Steht in der Personalakte beim Einsatzort als Arbeitgeber.",
};

/** The master data of a school's Schulträger or Gemeinde. */
export interface SchoolPartyFields {
  readonly name: string;
  readonly street: string;
  readonly postalCode: string;
  readonly city: string;
  readonly contactName: string;
  readonly contactPhone: string;
  readonly contactEmail: string;
  readonly creditorId: string;
  readonly accountHolder: string;
  readonly iban: string;
  readonly bic: string;
  readonly bankName: string;
}

export interface SchoolParty extends SchoolPartyFields {
  readonly kind: SchoolPartyKind;
  /** The read state a save sends back (ADR 0311). */
  readonly version: string;
}

/** One area of one school: the chosen body and the body that counts. */
export interface AreaResponsibility {
  readonly area: ResponsibilityArea;
  /** The body the settings name. */
  readonly body: ResponsibleBody;
  /** Where that value comes from. */
  readonly source: ResponsibilitySource;
  /** The Träger while the chosen body has no (complete) master data. */
  readonly effective: ResponsibleBody;
}

export interface SchoolResponsibility {
  readonly schoolId: string;
  readonly schoolName: string;
  readonly areas: readonly AreaResponsibility[];
  readonly parties: readonly SchoolParty[];
}

export const EMPTY_SCHOOL_PARTY: SchoolPartyFields = {
  name: "",
  street: "",
  postalCode: "",
  city: "",
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  creditorId: "",
  accountHolder: "",
  iban: "",
  bic: "",
  bankName: "",
};

function partyFromBackend(party: contract.SchoolParty): SchoolParty | null {
  const kind = knownEnum(SCHOOL_PARTY_KIND_VALUES, party.kind);
  if (!kind) return null;
  return {
    kind,
    name: party.name,
    street: party.street,
    postalCode: party.postal_code,
    city: party.city,
    contactName: party.contact_name,
    contactPhone: party.contact_phone,
    contactEmail: party.contact_email,
    creditorId: party.creditor_id,
    accountHolder: party.account_holder,
    iban: party.iban,
    bic: party.bic,
    bankName: party.bank_name,
    version: party.version,
  };
}

function areaFromBackend(
  area: contract.AreaResponsibility,
): AreaResponsibility | null {
  const known = knownEnum(RESPONSIBILITY_AREA_VALUES, area.area);
  const body = knownEnum(RESPONSIBLE_BODY_VALUES, area.body);
  const effective = knownEnum(RESPONSIBLE_BODY_VALUES, area.effective);
  if (!known || !body || !effective) return null;
  return {
    area: known,
    body,
    effective,
    source: knownEnum(RESPONSIBILITY_SOURCE_VALUES, area.source) ?? "default",
  };
}

function present<T>(value: T | null): value is T {
  return value !== null;
}

/** Every school of the Träger with its responsibilities, by name. */
export async function fetchResponsibilities(): Promise<SchoolResponsibility[]> {
  return mapResponsibilities(
    await bffJson("org", "GET /traeger/master-data/responsibilities"),
  );
}

export function mapResponsibilities(
  overview: contract.ResponsibilityOverview,
): SchoolResponsibility[] {
  return (overview.schools ?? []).map((school) => ({
    schoolId: school.school_id,
    schoolName: school.school_name,
    areas: (school.areas ?? []).map(areaFromBackend).filter(present),
    parties: (school.parties ?? []).map(partyFromBackend).filter(present),
  }));
}

/**
 * Stores the Schulträger or the Gemeinde of a school from the `version` it
 * was read at (ADR 0311); a body the school has none of yet sends "".
 */
export async function saveSchoolParty(
  schoolId: string,
  kind: SchoolPartyKind,
  fields: SchoolPartyFields,
  version: string,
): Promise<SchoolParty> {
  const body: contract.SchoolPartyRequest = {
    name: fields.name.trim(),
    street: fields.street.trim(),
    postal_code: fields.postalCode.trim(),
    city: fields.city.trim(),
    contact_name: fields.contactName.trim(),
    contact_phone: fields.contactPhone.trim(),
    contact_email: fields.contactEmail.trim(),
    creditor_id: fields.creditorId.trim(),
    account_holder: fields.accountHolder.trim(),
    iban: fields.iban.trim(),
    bic: fields.bic.trim(),
    bank_name: fields.bankName.trim(),
    expected_version: version,
  };
  const saved = partyFromBackend(
    await bffJson(
      "org",
      "PUT /traeger/master-data/responsibilities/schools/{schoolId}/parties/{kind}",
      { params: { schoolId, kind }, body },
    ),
  );
  if (!saved) throw new Error("Die gespeicherte Stelle ist unbekannt.");
  return saved;
}

/** Removes the body; the Träger is then responsible wherever it was named. */
export async function removeSchoolParty(
  schoolId: string,
  kind: SchoolPartyKind,
): Promise<void> {
  await bffJson(
    "org",
    "DELETE /traeger/master-data/responsibilities/schools/{schoolId}/parties/{kind}",
    { params: { schoolId, kind } },
  );
}

/** The stored body of a kind, or undefined. */
export function partyOf(
  school: Pick<SchoolResponsibility, "parties">,
  kind: SchoolPartyKind,
): SchoolParty | undefined {
  return school.parties.find((party) => party.kind === kind);
}

/** Whether the body can bill: creditor identifier and bank account. */
export function billingReady(party: SchoolPartyFields): boolean {
  return party.creditorId !== "" && party.iban !== "";
}

/**
 * Why the chosen body is not the one that counts: its master data are
 * missing, or (for billing) creditor identifier or bank account are.
 * Null where choice and effect agree.
 */
export function responsibilityGap(
  school: Pick<SchoolResponsibility, "parties">,
  area: AreaResponsibility,
): "missing" | "billing" | null {
  if (area.body === area.effective || area.body === "traeger") return null;
  return partyOf(school, area.body) ? "billing" : "missing";
}

/** The name a screen shows for the responsible body of an area. */
export function responsibleName(
  school: Pick<SchoolResponsibility, "parties">,
  body: ResponsibleBody,
): string {
  if (body === "traeger") return RESPONSIBLE_BODY_LABELS.traeger;
  return partyOf(school, body)?.name ?? RESPONSIBLE_BODY_LABELS[body];
}
