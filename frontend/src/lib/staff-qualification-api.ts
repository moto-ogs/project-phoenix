// Nachweise der Mitarbeitenden (#4808): Nachweisarten der Schule, die Liste
// aller Nachweise mit Status und die eigenen Nachweise einer Person.
//
// Arten und Liste brauchen staff:stammdaten; die eigenen Nachweise liest jede
// angemeldete Person. Archivierte Arten bleiben lesbar, weil eingetragene
// Nachweise auf sie zeigen.

import { bffJson } from "./bff-fetch";
import { knownEnum } from "./contract/known-enum";
import type {
  QualificationEntryResponse,
  QualificationOverviewResponse,
  QualificationTypeResponse,
} from "./contract/staff.generated";

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
  /** The stored state an edit sends back as `expected_version` (ADR 0311). */
  readonly version: string;
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

export function mapQualificationType(
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
    version: data.version,
  };
}

export function mapQualificationEntry(
  data: QualificationEntryResponse,
): QualificationEntry {
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

export function mapQualificationOverviewRow(
  row: QualificationOverviewResponse,
): QualificationOverviewRow {
  return {
    ...mapQualificationEntry(row),
    firstName: row.first_name,
    lastName: row.last_name,
  };
}

function typeBody(input: QualificationTypeInput) {
  return {
    name: input.name,
    validity_months: input.validityMonths,
    reminder_lead_weeks: input.reminderLeadWeeks,
    mandatory: input.mandatory,
    archived: input.archived,
  };
}

class StaffQualificationService {
  async listTypes(): Promise<QualificationType[]> {
    const types = await bffJson(
      "tenant",
      "GET /api/staff/qualification-types",
      {
        errorMessage: "Nachweisarten konnten nicht geladen werden",
      },
    );
    return types.map(mapQualificationType);
  }

  async createType(input: QualificationTypeInput): Promise<QualificationType> {
    const type = await bffJson(
      "tenant",
      "POST /api/staff/qualification-types",
      {
        body: typeBody(input),
        errorMessage: "Nachweisart konnte nicht gespeichert werden",
      },
    );
    return mapQualificationType(type);
  }

  /** `expectedVersion`: the version of the kind the form read (ADR 0311). */
  async updateType(
    id: string,
    input: QualificationTypeInput,
    expectedVersion: string,
  ): Promise<QualificationType> {
    const type = await bffJson(
      "tenant",
      "PUT /api/staff/qualification-types/{typeId}",
      {
        params: { typeId: id },
        body: { ...typeBody(input), expected_version: expectedVersion },
        errorMessage: "Nachweisart konnte nicht gespeichert werden",
      },
    );
    return mapQualificationType(type);
  }

  async overview(): Promise<QualificationOverviewRow[]> {
    const rows = await bffJson("tenant", "GET /api/staff/qualifications", {
      errorMessage: "Nachweise konnten nicht geladen werden",
    });
    return rows.map(mapQualificationOverviewRow);
  }

  async staffEntries(staffId: string): Promise<QualificationEntry[]> {
    const entries = await bffJson(
      "tenant",
      "GET /api/staff/{id}/qualifications",
      {
        params: { id: staffId },
        errorMessage: "Nachweise konnten nicht geladen werden",
      },
    );
    return entries.map(mapQualificationEntry);
  }

  async traegerProofs(staffId: string): Promise<TraegerProofStatus[]> {
    const proofs = await bffJson(
      "tenant",
      "GET /api/staff/{id}/traeger-proofs",
      {
        params: { id: staffId },
        errorMessage: "Nachweise des Trägers konnten nicht geladen werden",
      },
    );
    return proofs.map((proof) => ({
      typeName: proof.type_name,
      status: status(proof.status),
      expiresOn: proof.expires_on ?? "",
    }));
  }

  async ownEntries(): Promise<QualificationEntry[]> {
    const entries = await bffJson(
      "tenant",
      "GET /api/staff/me/qualifications",
      {
        errorMessage: "Nachweise konnten nicht geladen werden",
      },
    );
    return entries.map(mapQualificationEntry);
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
