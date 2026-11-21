// Nachweise der Mitarbeitenden (#4808): Nachweisarten der Schule, die Liste
// aller Nachweise mit Status und die eigenen Nachweise einer Person.
//
// Arten und Liste brauchen staff:stammdaten; die eigenen Nachweise liest jede
// angemeldete Person. Archivierte Arten bleiben lesbar, weil eingetragene
// Nachweise auf sie zeigen.

import { apiErrorFromResponse } from "./api-error";
import { knownEnum } from "./contract/known-enum";
import type {
  QualificationEntryResponse,
  QualificationOverviewResponse,
  QualificationTypeResponse,
  TraegerProofResponse,
} from "./contract/staff.generated";
import { sessionFetch } from "./session-cache";

export type QualificationStatus =
  "valid" | "expiring_soon" | "expired" | "missing";

export interface QualificationType {
  readonly id: string;
  /** Gesetzt für die Standardliste (Erste Hilfe am Kind, …). */
  readonly standardKey: string | null;
  readonly name: string;
  /** Gültigkeit in Monaten, schlägt das Ablaufdatum vor. */
  readonly validityMonths: number | null;
  /** Wie viele Wochen vor Ablauf die Erinnerung kommt. */
  readonly reminderLeadWeeks: number;
  readonly mandatory: boolean;
  readonly archived: boolean;
}

export interface QualificationTypeInput {
  readonly name: string;
  readonly validityMonths: number | null;
  readonly reminderLeadWeeks: number;
  readonly mandatory: boolean;
  readonly archived: boolean;
}

/**
 * Was die Schule von einem Nachweis sieht, den der Träger für die Person
 * führt (#4707, ADR 0089 Abschnitt 7): Art, Stand und Ablaufdatum.
 */
export interface TraegerProofStatus {
  readonly typeName: string;
  readonly status: QualificationStatus;
  readonly expiresOn: string;
}

export interface QualificationEntry {
  readonly staffId: string;
  /** Fehlt bei einem fehlenden Pflichtnachweis. */
  readonly qualificationId: string | null;
  readonly typeId: string | null;
  readonly name: string;
  readonly acquiredOn: string | null;
  readonly expiresOn: string | null;
  readonly status: QualificationStatus;
  readonly mandatory: boolean;
}

export interface QualificationOverviewRow extends QualificationEntry {
  readonly firstName: string;
  readonly lastName: string;
}

const STATUSES: readonly QualificationStatus[] = [
  "valid",
  "expiring_soon",
  "expired",
  "missing",
];

/** A status this build does not know asks for a look, like a missing proof. */
function status(value: string): QualificationStatus {
  return knownEnum(STATUSES, value) ?? "missing";
}

function mapQualificationType(
  data: QualificationTypeResponse,
): QualificationType {
  return {
    id: data.id,
    standardKey: data.standard_key ?? null,
    name: data.name,
    validityMonths: data.validity_months,
    reminderLeadWeeks: data.reminder_lead_weeks,
    mandatory: data.mandatory,
    archived: data.archived,
  };
}

function mapEntry(data: QualificationEntryResponse): QualificationEntry {
  return {
    staffId: data.staff_id,
    qualificationId: data.qualification_id,
    typeId: data.type_id,
    name: data.name,
    acquiredOn: data.acquired_on,
    expiresOn: data.expires_on,
    status: status(data.status),
    mandatory: data.mandatory,
  };
}

async function readData<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    throw await apiErrorFromResponse(response, fallback);
  }
  const json = (await response.json()) as { data: T };
  return json.data;
}

function typeBody(input: QualificationTypeInput): string {
  return JSON.stringify({
    name: input.name,
    validity_months: input.validityMonths,
    reminder_lead_weeks: input.reminderLeadWeeks,
    mandatory: input.mandatory,
    archived: input.archived,
  });
}

class StaffQualificationService {
  async listTypes(): Promise<QualificationType[]> {
    const data = await readData<QualificationTypeResponse[]>(
      await sessionFetch("/api/staff/qualification-types"),
      "Nachweisarten konnten nicht geladen werden",
    );
    return data.map(mapQualificationType);
  }

  async createType(input: QualificationTypeInput): Promise<QualificationType> {
    const data = await readData<QualificationTypeResponse>(
      await sessionFetch("/api/staff/qualification-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: typeBody(input),
      }),
      "Nachweisart konnte nicht gespeichert werden",
    );
    return mapQualificationType(data);
  }

  async updateType(
    id: string,
    input: QualificationTypeInput,
  ): Promise<QualificationType> {
    const data = await readData<QualificationTypeResponse>(
      await sessionFetch(`/api/staff/qualification-types/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: typeBody(input),
      }),
      "Nachweisart konnte nicht gespeichert werden",
    );
    return mapQualificationType(data);
  }

  async overview(): Promise<QualificationOverviewRow[]> {
    const data = await readData<QualificationOverviewResponse[]>(
      await sessionFetch("/api/staff/qualifications"),
      "Nachweise konnten nicht geladen werden",
    );
    return data.map((row) => ({
      ...mapEntry(row),
      firstName: row.first_name,
      lastName: row.last_name,
    }));
  }

  async staffEntries(staffId: string): Promise<QualificationEntry[]> {
    const data = await readData<QualificationEntryResponse[]>(
      await sessionFetch(`/api/staff/${staffId}/qualifications`),
      "Nachweise konnten nicht geladen werden",
    );
    return data.map(mapEntry);
  }

  /** Der Stand der Nachweise, die der Träger für die Person führt (#4707). */
  async traegerProofs(staffId: string): Promise<TraegerProofStatus[]> {
    const data = await readData<TraegerProofResponse[]>(
      await sessionFetch(`/api/staff/${staffId}/traeger-proofs`),
      "Nachweise des Trägers konnten nicht geladen werden",
    );
    return data.map((proof) => ({
      typeName: proof.type_name,
      status: status(proof.status),
      expiresOn: proof.expires_on ?? "",
    }));
  }

  async ownEntries(): Promise<QualificationEntry[]> {
    const data = await readData<QualificationEntryResponse[]>(
      await sessionFetch("/api/staff/me/qualifications"),
      "Nachweise konnten nicht geladen werden",
    );
    return data.map(mapEntry);
  }
}

export const staffQualificationService = new StaffQualificationService();

/** Text und Ton des Status, gleich in Liste, Profil und eigener Ansicht. */
export const QUALIFICATION_STATUS_LABELS: Record<
  QualificationStatus,
  {
    readonly label: string;
    readonly tone: "green" | "warning" | "red" | "gray";
  }
> = {
  valid: { label: "Gültig", tone: "green" },
  expiring_soon: { label: "Läuft bald ab", tone: "warning" },
  expired: { label: "Abgelaufen", tone: "red" },
  missing: { label: "Fehlt", tone: "gray" },
};

/**
 * Schlägt das Ablaufdatum aus Erwerb und Gültigkeit vor: gleicher Tag,
 * `months` Monate später; ein fehlender Monatstag rückt auf das Monatsende.
 */
export function suggestExpiry(
  acquiredOn: string,
  months: number | null,
): string | null {
  if (!months || !/^\d{4}-\d{2}-\d{2}$/.test(acquiredOn)) return null;
  const [year, month, day] = acquiredOn.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const total = month - 1 + months;
  const targetYear = year + Math.floor(total / 12);
  const targetMonth = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const targetDay = Math.min(day, lastDay);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${targetYear}-${pad(targetMonth)}-${pad(targetDay)}`;
}
