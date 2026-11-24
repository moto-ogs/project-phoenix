import { bffFile, bffJson } from "~/lib/bff-fetch";
/**
 * Nachweise am Personalstamm des Trägers (#4707, ADR 0089 Abschnitt 7,
 * ADR 0238).
 *
 * Die Personalverwaltung führt je Akte und Nachweisart einen Nachweis: Tag
 * der Vorlage und Ablaufdatum, beim Führungszeugnis dazu Ausstellungsdatum
 * und die Aussage „keine einschlägige Eintragung“, nie eine Kopie. Die Arten
 * mit Gültigkeit, Vorlauf der Warnung und Pflicht sind die des Trägers; jede
 * Art einer Schule wird einmal einer Art des Trägers zugeordnet. Jede Anfrage
 * mit Personen steht im Zugriffsprotokoll der Schulen. Backend-IDs werden
 * hier zu Strings.
 */
import {
  downloadTraegerList,
  type TraegerListFile,
  type TraegerListFormat,
  listExportQuery,
} from "./traeger-list-export";
import type * as traegerStaffProofsContract from "./contract/traeger-staff-proofs.generated";
import type * as sharedContract from "./contract/shared.generated";
import { knownEnum } from "./contract/known-enum";

// Go does not register the set; the contract types it as string. A value
// this build does not know stays undefined and shows as „–“.
const STAFF_PROOF_STATUS_VALUES = [
  "valid",
  "expiring_soon",
  "expired",
  "missing",
] as const;

/** Stand eines Nachweises, wie bei den Nachweisen der Schule (#4808). */
export type StaffProofStatus = (typeof STAFF_PROOF_STATUS_VALUES)[number];

export interface StaffProofType {
  readonly id: string;
  /** Gesetzt für die Standardarten. */
  readonly standardKey: string;
  readonly name: string;
  readonly validityMonths: number | null;
  readonly reminderLeadWeeks: number;
  readonly mandatory: boolean;
  readonly archived: boolean;
  /** Das Führungszeugnis: moto speichert das Ergebnis, kein Dokument. */
  readonly policeCertificate: boolean;
  /** Stand der Felder; eine Änderung schickt ihn zurück (ADR 0311). */
  readonly version: string;
}

export interface StaffProofTypeInput {
  readonly name: string;
  readonly validityMonths: number | null;
  readonly reminderLeadWeeks: number;
  readonly mandatory: boolean;
  readonly archived: boolean;
}

/** Der Stand einer Art an einer Akte. */
export interface StaffProof {
  readonly typeId: string;
  readonly typeName: string;
  readonly mandatory: boolean;
  readonly policeCertificate: boolean;
  readonly held: boolean;
  /**
   * Leer für eine freiwillige Art ohne Nachweis; undefined für einen Stand,
   * den dieser Build nicht kennt.
   */
  readonly status: StaffProofStatus | "" | undefined;
  readonly presentedOn: string;
  readonly issuedOn: string;
  readonly noRelevantEntry: boolean;
  readonly expiresOn: string;
}

export interface StaffProofInput {
  readonly presentedOn: string;
  readonly issuedOn: string;
  readonly noRelevantEntry: boolean;
  /** Leer: moto rechnet das Ablaufdatum aus der Gültigkeit der Art. */
  readonly expiresOn: string;
}

export interface StaffProofEntry {
  readonly recordId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly personnelNumber: string | null;
  readonly schools: readonly string[];
  readonly typeId: string;
  readonly typeName: string;
  /** undefined: ein Stand, den dieser Build nicht kennt. */
  readonly status: StaffProofStatus | undefined;
  readonly presentedOn: string;
  readonly expiresOn: string;
}

interface StaffProofCounts {
  readonly expired: number;
  readonly expiringSoon: number;
  readonly missing: number;
  readonly valid: number;
}

export interface StaffProofList {
  readonly today: string;
  readonly types: readonly StaffProofType[];
  readonly entries: readonly StaffProofEntry[];
  readonly counts: StaffProofCounts;
}

interface SchoolProofKind {
  readonly schoolTypeId: string;
  readonly name: string;
  readonly proofTypeId: string | null;
}

export interface SchoolProofKinds {
  readonly schoolId: string;
  readonly schoolName: string;
  readonly kinds: readonly SchoolProofKind[];
}

function mapType(
  kind: traegerStaffProofsContract.TraegerStaffProofType,
): StaffProofType {
  return {
    id: kind.id,
    standardKey: kind.standard_key ?? "",
    name: kind.name,
    validityMonths: kind.validity_months,
    reminderLeadWeeks: kind.reminder_lead_weeks,
    mandatory: kind.mandatory,
    archived: kind.archived,
    policeCertificate: kind.police_certificate,
    version: kind.version,
  };
}

/** Der Stand einer Art an einer Akte, wie Akte und Speichern ihn liefern. */
export function mapStaffProof(
  proof: sharedContract.TraegerStaffProof,
): StaffProof {
  return {
    typeId: proof.type_id,
    typeName: proof.type_name,
    mandatory: proof.mandatory,
    policeCertificate: proof.police_certificate,
    held: proof.held,
    status:
      proof.status === ""
        ? ""
        : knownEnum(STAFF_PROOF_STATUS_VALUES, proof.status),
    presentedOn: proof.presented_on ?? "",
    issuedOn: proof.issued_on ?? "",
    noRelevantEntry: proof.no_relevant_entry,
    expiresOn: proof.expires_on ?? "",
  };
}

function mapSchoolKinds(
  data: traegerStaffProofsContract.TraegerSchoolProofKinds[],
): SchoolProofKinds[] {
  return data.map((school) => ({
    schoolId: school.school_id,
    schoolName: school.school_name,
    kinds: (school.kinds ?? []).map((kind) => ({
      schoolTypeId: kind.school_type_id,
      name: kind.name,
      proofTypeId: kind.proof_type_id,
    })),
  }));
}

export async function fetchStaffProofList(): Promise<StaffProofList> {
  const data = await bffJson("org", "GET /traeger/staff-proofs/");
  return {
    today: data.today,
    types: (data.types ?? []).map(mapType),
    entries: (data.entries ?? []).map((entry) => ({
      recordId: entry.staff_record_id,
      firstName: entry.first_name,
      lastName: entry.last_name,
      personnelNumber: entry.personnel_number,
      schools: entry.schools ?? [],
      typeId: entry.type_id,
      typeName: entry.type_name,
      status: knownEnum(STAFF_PROOF_STATUS_VALUES, entry.status),
      presentedOn: entry.presented_on ?? "",
      expiresOn: entry.expires_on ?? "",
    })),
    counts: {
      expired: data.counts.expired,
      expiringSoon: data.counts.expiring_soon,
      missing: data.counts.missing,
      valid: data.counts.valid,
    },
  };
}

function typeBody(
  input: StaffProofTypeInput,
): traegerStaffProofsContract.ProofTypeRequest {
  return {
    name: input.name,
    validity_months: input.validityMonths,
    reminder_lead_weeks: input.reminderLeadWeeks,
    mandatory: input.mandatory,
    archived: input.archived,
  };
}

/**
 * Legt eine Nachweisart an (`changed` null) oder ändert sie auf dem Stand
 * `changed.version`, den der Dialog beim Öffnen las (ADR 0311).
 */
export async function saveStaffProofType(
  changed: { readonly id: string; readonly version: string } | null,
  input: StaffProofTypeInput,
): Promise<StaffProofType> {
  return mapType(
    await (changed === null
      ? bffJson("org", "POST /traeger/staff-proofs/types", {
          body: typeBody(input),
        })
      : bffJson("org", "PUT /traeger/staff-proofs/types/{id}", {
          params: { id: changed.id },
          body: { ...typeBody(input), expected_version: changed.version },
        })),
  );
}

export async function fetchSchoolProofKinds(): Promise<SchoolProofKinds[]> {
  return mapSchoolKinds(
    await bffJson("org", "GET /traeger/staff-proofs/school-kinds"),
  );
}

export async function mapSchoolProofKind(
  schoolId: string,
  schoolTypeId: string,
  proofTypeId: string | null,
): Promise<SchoolProofKinds[]> {
  return mapSchoolKinds(
    await bffJson("org", "PUT /traeger/staff-proofs/school-kinds", {
      body: {
        school_id: schoolId,
        school_type_id: schoolTypeId,
        proof_type_id: proofTypeId === null ? null : proofTypeId,
      } satisfies traegerStaffProofsContract.ProofMappingRequest,
    }),
  );
}

export async function saveStaffProof(
  recordId: string,
  typeId: string,
  input: StaffProofInput,
): Promise<StaffProof[]> {
  const data = await bffJson(
    "org",
    "PUT /traeger/staff-proofs/records/{id}/{typeId}",
    {
      params: { id: recordId, typeId },
      body: {
        presented_on: input.presentedOn,
        issued_on: input.issuedOn,
        no_relevant_entry: input.noRelevantEntry,
        expires_on: input.expiresOn,
      } satisfies traegerStaffProofsContract.ProofRequest,
    },
  );
  return data.map(mapStaffProof);
}

export async function deleteStaffProof(
  recordId: string,
  typeId: string,
): Promise<StaffProof[]> {
  const data = await bffJson(
    "org",
    "DELETE /traeger/staff-proofs/records/{id}/{typeId}",
    { params: { id: recordId, typeId } },
  );
  return data.map(mapStaffProof);
}

/** Die Ablaufliste als CSV, mit dem Dateinamen des Backends. */
export function downloadStaffProofList(
  format: TraegerListFormat,
): Promise<TraegerListFile> {
  return downloadTraegerList(
    bffFile("org", "GET /traeger/staff-proofs/export", {
      query: listExportQuery(format),
    }),
  );
}

/** Name, Farbe und Satz je Stand, wie auf der Liste der Schule. */
export const STAFF_PROOF_STATUS: Record<
  StaffProofStatus,
  {
    readonly label: string;
    readonly tone: "green" | "warning" | "red" | "gray";
  }
> = {
  expired: { label: "Abgelaufen", tone: "red" },
  missing: { label: "Fehlt", tone: "gray" },
  expiring_soon: { label: "Läuft bald ab", tone: "warning" },
  valid: { label: "Gültig", tone: "green" },
};
