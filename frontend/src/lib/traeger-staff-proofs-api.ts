/**
 * Nachweise am Personalstamm des Trägers (#4707, ADR 0089 Abschnitt 7,
 * ADR 0236).
 *
 * Die Personalverwaltung führt je Akte und Nachweisart einen Nachweis: Tag
 * der Vorlage und Ablaufdatum, beim Führungszeugnis dazu Ausstellungsdatum
 * und die Aussage „keine einschlägige Eintragung“, nie eine Kopie. Die Arten
 * mit Gültigkeit, Vorlauf der Warnung und Pflicht sind die des Trägers; jede
 * Art einer Schule wird einmal einer Art des Trägers zugeordnet. Jede Anfrage
 * mit Personen steht im Zugriffsprotokoll der Schulen. Backend-IDs werden
 * hier zu Strings.
 */
import { apiErrorFromBody, transportFetch } from "./api-error";
import { filenameFromDisposition } from "./file-download";
import { readJson, traegerRequest } from "~/lib/traeger-api";

const BASE = "/api/traeger/staff-proofs";

/** Stand eines Nachweises, wie bei den Nachweisen der Schule (#4808). */
export type StaffProofStatus =
  "valid" | "expiring_soon" | "expired" | "missing";

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
  /** Leer für eine freiwillige Art ohne Nachweis. */
  readonly status: StaffProofStatus | "";
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
  readonly status: StaffProofStatus;
  readonly presentedOn: string;
  readonly expiresOn: string;
}

export interface StaffProofCounts {
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

export interface SchoolProofKind {
  readonly schoolTypeId: string;
  readonly name: string;
  readonly proofTypeId: string | null;
}

export interface SchoolProofKinds {
  readonly schoolId: string;
  readonly schoolName: string;
  readonly kinds: readonly SchoolProofKind[];
}

interface BackendType {
  id: number;
  standard_key?: string;
  name: string;
  validity_months: number | null;
  reminder_lead_weeks: number;
  mandatory: boolean;
  archived: boolean;
  police_certificate: boolean;
}

export interface BackendProof {
  type_id: number;
  type_name: string;
  mandatory: boolean;
  police_certificate: boolean;
  held: boolean;
  status: StaffProofStatus | "";
  presented_on?: string;
  issued_on?: string;
  no_relevant_entry: boolean;
  expires_on?: string;
}

interface BackendList {
  today: string;
  types: BackendType[] | null;
  entries:
    | {
        staff_record_id: number;
        first_name: string;
        last_name: string;
        personnel_number: string | null;
        schools: string[] | null;
        type_id: number;
        type_name: string;
        status: StaffProofStatus;
        presented_on?: string;
        expires_on?: string;
      }[]
    | null;
  counts: {
    expired: number;
    expiring_soon: number;
    missing: number;
    valid: number;
  };
}

interface BackendSchoolKinds {
  school_id: number;
  school_name: string;
  kinds:
    | { school_type_id: number; name: string; proof_type_id: number | null }[]
    | null;
}

function mapType(kind: BackendType): StaffProofType {
  return {
    id: String(kind.id),
    standardKey: kind.standard_key ?? "",
    name: kind.name,
    validityMonths: kind.validity_months,
    reminderLeadWeeks: kind.reminder_lead_weeks,
    mandatory: kind.mandatory,
    archived: kind.archived,
    policeCertificate: kind.police_certificate,
  };
}

/** Der Stand einer Art an einer Akte, wie Akte und Speichern ihn liefern. */
export function mapStaffProof(proof: BackendProof): StaffProof {
  return {
    typeId: String(proof.type_id),
    typeName: proof.type_name,
    mandatory: proof.mandatory,
    policeCertificate: proof.police_certificate,
    held: proof.held,
    status: proof.status,
    presentedOn: proof.presented_on ?? "",
    issuedOn: proof.issued_on ?? "",
    noRelevantEntry: proof.no_relevant_entry,
    expiresOn: proof.expires_on ?? "",
  };
}

function mapSchoolKinds(data: BackendSchoolKinds[] | null): SchoolProofKinds[] {
  return (data ?? []).map((school) => ({
    schoolId: String(school.school_id),
    schoolName: school.school_name,
    kinds: (school.kinds ?? []).map((kind) => ({
      schoolTypeId: String(kind.school_type_id),
      name: kind.name,
      proofTypeId:
        kind.proof_type_id === null ? null : String(kind.proof_type_id),
    })),
  }));
}

export async function fetchStaffProofList(): Promise<StaffProofList> {
  const data = await traegerRequest<BackendList>(BASE);
  return {
    today: data.today,
    types: (data.types ?? []).map(mapType),
    entries: (data.entries ?? []).map((entry) => ({
      recordId: String(entry.staff_record_id),
      firstName: entry.first_name,
      lastName: entry.last_name,
      personnelNumber: entry.personnel_number,
      schools: entry.schools ?? [],
      typeId: String(entry.type_id),
      typeName: entry.type_name,
      status: entry.status,
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

function typeBody(input: StaffProofTypeInput) {
  return {
    name: input.name,
    validity_months: input.validityMonths,
    reminder_lead_weeks: input.reminderLeadWeeks,
    mandatory: input.mandatory,
    archived: input.archived,
  };
}

export async function fetchStaffProofTypes(): Promise<StaffProofType[]> {
  return (
    (await traegerRequest<BackendType[] | null>(`${BASE}/types`)) ?? []
  ).map(mapType);
}

export async function saveStaffProofType(
  id: string | null,
  input: StaffProofTypeInput,
): Promise<StaffProofType> {
  return mapType(
    await traegerRequest<BackendType>(
      id === null ? `${BASE}/types` : `${BASE}/types/${encodeURIComponent(id)}`,
      { method: id === null ? "POST" : "PUT", body: typeBody(input) },
    ),
  );
}

export async function fetchSchoolProofKinds(): Promise<SchoolProofKinds[]> {
  return mapSchoolKinds(
    await traegerRequest<BackendSchoolKinds[] | null>(`${BASE}/school-kinds`),
  );
}

export async function mapSchoolProofKind(
  schoolId: string,
  schoolTypeId: string,
  proofTypeId: string | null,
): Promise<SchoolProofKinds[]> {
  return mapSchoolKinds(
    await traegerRequest<BackendSchoolKinds[] | null>(`${BASE}/school-kinds`, {
      method: "PUT",
      body: {
        school_id: Number(schoolId),
        school_type_id: Number(schoolTypeId),
        proof_type_id: proofTypeId === null ? null : Number(proofTypeId),
      },
    }),
  );
}

const proofPath = (recordId: string, typeId: string) =>
  `${BASE}/records/${encodeURIComponent(recordId)}/${encodeURIComponent(typeId)}`;

export async function saveStaffProof(
  recordId: string,
  typeId: string,
  input: StaffProofInput,
): Promise<StaffProof[]> {
  const data = await traegerRequest<BackendProof[] | null>(
    proofPath(recordId, typeId),
    {
      method: "PUT",
      body: {
        presented_on: input.presentedOn,
        issued_on: input.issuedOn,
        no_relevant_entry: input.noRelevantEntry,
        expires_on: input.expiresOn,
      },
    },
  );
  return (data ?? []).map(mapStaffProof);
}

export async function deleteStaffProof(
  recordId: string,
  typeId: string,
): Promise<StaffProof[]> {
  const data = await traegerRequest<BackendProof[] | null>(
    proofPath(recordId, typeId),
    { method: "DELETE" },
  );
  return (data ?? []).map(mapStaffProof);
}

/** Die Ablaufliste als CSV, mit dem Dateinamen des Backends. */
export async function downloadStaffProofList(): Promise<{
  readonly blob: Blob;
  readonly filename: string | null;
}> {
  const response = await transportFetch(`${BASE}/export`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    throw apiErrorFromBody(
      `Request failed (${response.status})`,
      response.status,
      await readJson(response),
    );
  }
  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(response),
  };
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
