import { apiErrorFromResponse, type ApiError } from "./api-error";
// API client for the school's own Abwesenheitsarten (#2403).
//
// These sit next to the five standard types (Urlaub, Krank, Fortbildung,
// Sonstige, Freizeitausgleich), which are code constants on both sides and
// never appear in this list. A school-defined art is a named subtype of
// "Sonstige" and inherits its calculation — the name changes what people read,
// never what the Stundenkonto or das Urlaubskontingent do.
//
// Reads need time_tracking:manage or vacation:approve; writes need
// time_tracking:manage. There is no delete: a used art is deactivated, so it
// stays readable on the absences already filed under it.

import { sessionFetch } from "./session-cache";

interface BackendAbsenceType {
  id: string;
  name: string;
  base_type: string;
  is_active: boolean;
  allowance_enabled: boolean;
  carryover_until?: string | null;
  requestable?: boolean;
  kept_by_traeger?: boolean;
  offered?: boolean;
  school_limit_days?: number | null;
}

export interface AbsenceType {
  /** Backend int64 as a string, matching the repo-wide ID convention. */
  readonly id: string;
  readonly name: string;
  /** The standard type whose calculation this art inherits (today: "other"). */
  readonly baseType: string;
  readonly isActive: boolean;
  /**
   * The art keeps an own yearly account per person. A booking above it is
   * always refused (#3256).
   */
  readonly allowanceEnabled: boolean;
  /**
   * "MM-DD" in the following year until which a rest stays usable, or null
   * when the rest expires on 31.12. (#3257).
   */
  readonly carryoverUntil: string | null;
  /** Mitarbeitende beantragen die Art, die Leitung entscheidet (#4710). */
  readonly requestable: boolean;
  /**
   * Eine Art des Trägers (#4710): Name, Kontingent, Verfall und
   * „beantragbar" legt der Träger fest. Die Schule weicht nur mit `offered`
   * und `schoolLimitDays` ab, und nur für Einsätze an dieser Schule.
   */
  readonly keptByTraeger: boolean;
  readonly offered: boolean;
  /** Höchstens so viele Tage je Person und Jahr an dieser Schule. */
  readonly schoolLimitDays: number | null;
}

function mapAbsenceType(data: BackendAbsenceType): AbsenceType {
  return {
    id: data.id,
    name: data.name,
    baseType: data.base_type,
    isActive: data.is_active,
    allowanceEnabled: data.allowance_enabled,
    carryoverUntil: data.carryover_until ?? null,
    requestable: data.requestable ?? false,
    keptByTraeger: data.kept_by_traeger ?? false,
    offered: data.offered ?? true,
    schoolLimitDays: data.school_limit_days ?? null,
  };
}

function readError(response: Response, fallback: string): Promise<ApiError> {
  return apiErrorFromResponse(response, fallback);
}

async function readList(response: Response): Promise<AbsenceType[]> {
  if (!response.ok) {
    throw await readError(
      response,
      "Abwesenheitsarten konnten nicht geladen werden",
    );
  }
  const json = (await response.json()) as {
    data: BackendAbsenceType[] | null;
  };
  return (json.data ?? []).map(mapAbsenceType);
}

async function readOne(response: Response): Promise<AbsenceType> {
  if (!response.ok) {
    throw await readError(
      response,
      "Abwesenheitsart konnte nicht gespeichert werden",
    );
  }
  const json = (await response.json()) as { data: BackendAbsenceType };
  return mapAbsenceType(json.data);
}

class AbsenceTypeService {
  async getAbsenceTypes(): Promise<AbsenceType[]> {
    const response = await sessionFetch("/api/absence-types");
    return readList(response);
  }

  async createAbsenceType(
    name: string,
    config: {
      allowanceEnabled: boolean;
      carryoverUntil?: string | null;
      requestable?: boolean;
    },
  ): Promise<AbsenceType> {
    const response = await sessionFetch("/api/absence-types", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        allowance_enabled: config.allowanceEnabled,
        requestable: config.requestable ?? false,
        ...(config.carryoverUntil !== undefined
          ? { carryover_until: config.carryoverUntil ?? "" }
          : {}),
      }),
    });
    return readOne(response);
  }

  /**
   * Renames and/or (de)activates. Omitted fields stay as they are. A type of
   * the Träger takes only `offered` and `schoolLimitDays` (null removes the
   * limit).
   */
  async updateAbsenceType(
    id: string,
    changes: {
      name?: string;
      isActive?: boolean;
      allowanceEnabled?: boolean;
      carryoverUntil?: string | null;
      requestable?: boolean;
      offered?: boolean;
      schoolLimitDays?: number | null;
    },
  ): Promise<AbsenceType> {
    const response = await sessionFetch(`/api/absence-types/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(changes.name !== undefined ? { name: changes.name } : {}),
        ...(changes.isActive !== undefined
          ? { is_active: changes.isActive }
          : {}),
        ...(changes.allowanceEnabled !== undefined
          ? { allowance_enabled: changes.allowanceEnabled }
          : {}),
        ...(changes.carryoverUntil !== undefined
          ? { carryover_until: changes.carryoverUntil ?? "" }
          : {}),
        ...(changes.requestable !== undefined
          ? { requestable: changes.requestable }
          : {}),
        ...(changes.offered !== undefined ? { offered: changes.offered } : {}),
        ...(changes.schoolLimitDays !== undefined
          ? { school_limit_days: changes.schoolLimitDays }
          : {}),
      }),
    });
    return readOne(response);
  }

  async getAllowance(
    absenceTypeId: string,
    staffId: string,
    year: number,
  ): Promise<AbsenceTypeAllowanceSummary> {
    const response = await sessionFetch(
      `/api/staff/absence-types/${absenceTypeId}/allowances/${staffId}?year=${year}`,
    );
    return readAllowance(response);
  }

  /**
   * Which yearly Kontingent a planned booking uses. `blocked` is true when
   * one of them would drop below zero; the booking is then refused.
   */
  async previewAllowance(
    absenceTypeId: string,
    staffId: string,
    booking: { dateStart: string; dateEnd: string; halfDay: boolean },
  ): Promise<AbsenceTypeAllowancePreview> {
    const query = new URLSearchParams({
      date_start: booking.dateStart,
      date_end: booking.dateEnd,
      half_day: String(booking.halfDay),
    });
    const response = await sessionFetch(
      `/api/absence-types/${absenceTypeId}/allowances/${staffId}/preview?${query.toString()}`,
    );
    if (!response.ok) {
      throw await readError(
        response,
        "Die Vorschau konnte nicht berechnet werden",
      );
    }
    const json = (await response.json()) as {
      data: {
        years: BackendAbsenceTypeAllowanceSummary[] | null;
        blocked: boolean;
        blocked_by?: "allowance" | "school_limit";
      };
    };
    return {
      years: (json.data.years ?? []).map(mapAllowance),
      blocked: json.data.blocked,
      blockedBy: json.data.blocked
        ? (json.data.blocked_by ?? "allowance")
        : null,
    };
  }

  async setAllowance(
    absenceTypeId: string,
    staffId: string,
    payload: { year: number; entitledDays: number; reason: string },
  ): Promise<AbsenceTypeAllowanceSummary> {
    const response = await sessionFetch(
      `/api/staff/absence-types/${absenceTypeId}/allowances/${staffId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: payload.year,
          entitled_days: payload.entitledDays,
          reason: payload.reason,
        }),
      },
    );
    return readAllowance(response);
  }
}

export interface BackendAbsenceTypeAllowanceSummary {
  staff_id: string;
  absence_type_id: string;
  year: number;
  entitled_days: number;
  taken_days: number;
  reserved_days: number;
  remaining_days: number;
  expires_on?: string;
  expired_days?: number;
  booking_days?: number;
  carried_in?: {
    year: number;
    remaining_days: number;
    expired_days: number;
    expires_on: string;
  } | null;
  kept_by_traeger?: boolean;
}

/** The previous year's rest as seen from the year it is carried into. */
interface AbsenceTypeAllowanceCarry {
  readonly year: number;
  readonly remainingDays: number;
  readonly expiredDays: number;
  readonly expiresOn: string;
}

interface AbsenceTypeAllowancePreview {
  readonly years: readonly AbsenceTypeAllowanceSummary[];
  readonly blocked: boolean;
  /**
   * Why the booking is refused: the Kontingent, or the school's limit for a
   * type of its Träger (#4710).
   */
  readonly blockedBy: "allowance" | "school_limit" | null;
}

export interface AbsenceTypeAllowanceSummary {
  readonly staffId: string;
  readonly absenceTypeId: string;
  readonly year: number;
  readonly entitledDays: number;
  readonly takenDays: number;
  readonly reservedDays: number;
  readonly remainingDays: number;
  /** Last day (YYYY-MM-DD) the rest can be booked. */
  readonly expiresOn: string;
  /** Rest left when expiresOn passed; shown, never dropped. */
  readonly expiredDays: number;
  /** On previews: what the booking takes from this year. */
  readonly bookingDays: number;
  readonly carriedIn: AbsenceTypeAllowanceCarry | null;
  /**
   * Der Träger führt dieses Konto über alle Schulen der Person (#4710); die
   * Schule liest es nur.
   */
  readonly keptByTraeger: boolean;
}

export function mapAllowance(
  data: BackendAbsenceTypeAllowanceSummary,
): AbsenceTypeAllowanceSummary {
  return {
    staffId: data.staff_id,
    absenceTypeId: data.absence_type_id,
    year: data.year,
    entitledDays: data.entitled_days,
    takenDays: data.taken_days,
    reservedDays: data.reserved_days,
    remainingDays: data.remaining_days,
    expiresOn: data.expires_on ?? `${data.year}-12-31`,
    expiredDays: data.expired_days ?? 0,
    bookingDays: data.booking_days ?? 0,
    carriedIn: data.carried_in
      ? {
          year: data.carried_in.year,
          remainingDays: data.carried_in.remaining_days,
          expiredDays: data.carried_in.expired_days,
          expiresOn: data.carried_in.expires_on,
        }
      : null,
    keptByTraeger: data.kept_by_traeger ?? false,
  };
}

async function readAllowance(
  response: Response,
): Promise<AbsenceTypeAllowanceSummary> {
  if (!response.ok) {
    throw await readError(
      response,
      "Kontingent konnte nicht gespeichert werden",
    );
  }
  const json = (await response.json()) as {
    data: BackendAbsenceTypeAllowanceSummary;
  };
  return mapAllowance(json.data);
}

export const absenceTypeService = new AbsenceTypeService();
