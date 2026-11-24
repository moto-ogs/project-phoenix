import { bffJson } from "~/lib/bff-fetch";
/**
 * Abwesenheitsarten und Kontingente des Trägers (#4710, ADR 0089 §10 mit
 * Nachtrag, ADR 0236).
 *
 * Die Personalverwaltung legt Arten wie Regenerationstag an. moto trägt jede
 * Art in jede Schule des Trägers. Eine Schule darf abweichen, nur für ihre
 * Einsätze: nicht anbieten oder höchstens N Tage je Person und Jahr. Eine
 * Person mit Personalakte hat je Art und Jahr ein Kontingent über alle
 * Schulen. Kontingente sind Personendaten: jede Anfrage steht im
 * Zugriffsprotokoll der Schulen, nichts wird zwischengespeichert.
 */
import type * as traegerAbsenceTypesContract from "~/lib/contract/traeger-absence-types.generated";
import type * as traegerStaffRecordsContract from "~/lib/contract/traeger-staff-records.generated";

/** Wie eine Schule eine Art des Trägers führt. */
export interface TraegerAbsenceTypeSchool {
  readonly schoolId: string;
  readonly schoolName: string;
  /** `false`, solange die Art an der Schule noch nicht angekommen ist. */
  readonly carried: boolean;
  /** Abweichung: `false`, wenn die Schule die Art nicht anbietet. */
  readonly offered: boolean;
  /** Abweichung: höchstens so viele Tage je Person und Jahr an der Schule. */
  readonly schoolLimitDays: number | null;
}

export interface TraegerAbsenceType {
  readonly id: string;
  readonly name: string;
  readonly allowanceEnabled: boolean;
  readonly standardDays: number;
  /** `MM-DD` im Folgejahr oder `null` (Rest verfällt am 31.12.). */
  readonly carryoverUntil: string | null;
  readonly requestable: boolean;
  readonly isActive: boolean;
  readonly schools: readonly TraegerAbsenceTypeSchool[];
  /** Stand der Felder; Bearbeiten und Aus-/Einschalten schicken ihn zurück
   *  (ADR 0311). */
  readonly version: string;
}

export interface TraegerAbsenceTypeList {
  /** `null`, solange das moto-Team „Personal beim Träger“ nicht freigibt. */
  readonly released: boolean;
  readonly schoolCount: number;
  readonly types: readonly TraegerAbsenceType[];
}

export interface TraegerAbsenceTypeInput {
  readonly name: string;
  readonly allowanceEnabled: boolean;
  readonly standardDays: number;
  readonly carryoverUntil: string | null;
  readonly requestable: boolean;
  readonly isActive: boolean;
}

/** Was die Buchungen einer Schule von einem Kontingent nehmen. */
export interface TraegerAbsenceSchoolUse {
  readonly schoolId: string;
  readonly schoolName: string;
  readonly takenDays: number;
  readonly reservedDays: number;
  readonly limitDays: number | null;
  readonly offered: boolean;
}

export interface TraegerAbsenceAccount {
  readonly absenceTypeId: string;
  readonly absenceTypeName: string;
  readonly year: number;
  readonly entitledDays: number;
  /** `true`, wenn die Personalverwaltung den Anspruch für die Person setzt. */
  readonly individual: boolean;
  readonly standardDays: number;
  readonly takenDays: number;
  readonly reservedDays: number;
  readonly remainingDays: number;
  readonly expiresOn: string;
  readonly expiredDays: number;
  readonly carriedIn: {
    readonly year: number;
    readonly remainingDays: number;
    readonly expiredDays: number;
    readonly expiresOn: string;
  } | null;
  readonly schools: readonly TraegerAbsenceSchoolUse[];
  /** Token of the person's claim; the change of the days sends it back
   *  (ADR 0311). */
  readonly version: string;
}

function mapType(
  data: traegerAbsenceTypesContract.TraegerAbsenceType,
): TraegerAbsenceType {
  return {
    id: data.id,
    name: data.name,
    allowanceEnabled: data.allowance_enabled,
    standardDays: data.standard_days,
    carryoverUntil: data.carryover_until || null,
    requestable: data.requestable,
    isActive: data.is_active,
    schools: (data.schools ?? []).map((school) => ({
      schoolId: school.school_id,
      schoolName: school.school_name,
      carried: school.carried,
      offered: school.offered,
      schoolLimitDays: school.school_limit_days,
    })),
    version: data.version,
  };
}

function mapAccount(
  data: traegerStaffRecordsContract.TraegerAbsenceAccount,
): TraegerAbsenceAccount {
  return {
    absenceTypeId: data.absence_type_id,
    absenceTypeName: data.absence_type_name,
    year: data.year,
    entitledDays: data.entitled_days,
    individual: data.individual,
    standardDays: data.standard_days,
    takenDays: data.taken_days,
    reservedDays: data.reserved_days,
    remainingDays: data.remaining_days,
    expiresOn: data.expires_on,
    expiredDays: data.expired_days,
    version: data.version,
    carriedIn: data.carried_in
      ? {
          year: data.carried_in.year,
          remainingDays: data.carried_in.remaining_days,
          expiredDays: data.carried_in.expired_days,
          expiresOn: data.carried_in.expires_on,
        }
      : null,
    schools: (data.schools ?? []).map((school) => ({
      schoolId: school.school_id,
      schoolName: school.school_name,
      takenDays: school.taken_days,
      reservedDays: school.reserved_days,
      limitDays: school.limit_days,
      offered: school.offered,
    })),
  };
}

function typeBody(
  input: TraegerAbsenceTypeInput,
): traegerAbsenceTypesContract.AbsenceTypeRequest {
  return {
    name: input.name.trim(),
    allowance_enabled: input.allowanceEnabled,
    standard_days: input.allowanceEnabled ? input.standardDays : 0,
    carryover_until: input.allowanceEnabled ? (input.carryoverUntil ?? "") : "",
    requestable: input.requestable,
    is_active: input.isActive,
  };
}

export async function fetchTraegerAbsenceTypes(): Promise<TraegerAbsenceTypeList> {
  const data = await bffJson("org", "GET /traeger/absence-types/");
  return {
    released: data.release !== null,
    schoolCount: (data.schools ?? []).length,
    types: (data.types ?? []).map(mapType),
  };
}

export async function createTraegerAbsenceType(
  input: TraegerAbsenceTypeInput,
): Promise<TraegerAbsenceType> {
  return mapType(
    await bffJson("org", "POST /traeger/absence-types/", {
      body: typeBody(input),
    }),
  );
}

/** Schreibt die Art neu, auf dem Stand `expectedVersion` (ADR 0311). */
export async function updateTraegerAbsenceType(
  id: string,
  input: TraegerAbsenceTypeInput,
  expectedVersion: string,
): Promise<TraegerAbsenceType> {
  return mapType(
    await bffJson("org", "PUT /traeger/absence-types/{id}", {
      params: { id },
      body: { ...typeBody(input), expected_version: expectedVersion },
    }),
  );
}

export async function fetchTraegerAbsenceAccounts(
  recordId: string,
  year: number,
): Promise<readonly TraegerAbsenceAccount[]> {
  const data = await bffJson(
    "org",
    "GET /traeger/staff-records/{id}/absence-accounts",
    { params: { id: recordId }, query: { year } },
  );
  return (data.accounts ?? []).map(mapAccount);
}

export async function setTraegerAbsenceAllowance(
  recordId: string,
  typeId: string,
  input: {
    year: number;
    entitledDays: number;
    reason: string;
    /** Version of the account the form was read from (ADR 0311). */
    expectedVersion: string;
  },
): Promise<void> {
  await bffJson(
    "org",
    "PUT /traeger/staff-records/{id}/absence-accounts/{typeId}",
    {
      params: { id: recordId, typeId },
      body: {
        year: input.year,
        entitled_days: input.entitledDays,
        reason: input.reason.trim(),
        expected_version: input.expectedVersion,
      } satisfies traegerStaffRecordsContract.AbsenceAllowanceRequest,
    },
  );
}
