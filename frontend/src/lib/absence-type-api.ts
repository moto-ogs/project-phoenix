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

import { bffJson } from "./bff-fetch";
import { knownEnum } from "./contract/known-enum";
import type {
  AbsenceTypeResponse,
  AllowanceSummaryResponse,
} from "./contract/absence-types.generated";

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

function mapAbsenceType(data: AbsenceTypeResponse): AbsenceType {
  return {
    id: data.id,
    name: data.name,
    baseType: data.base_type,
    isActive: data.is_active,
    allowanceEnabled: data.allowance_enabled,
    carryoverUntil: data.carryover_until,
    requestable: data.requestable,
    keptByTraeger: data.kept_by_traeger,
    offered: data.offered ?? true,
    schoolLimitDays: data.school_limit_days,
  };
}

class AbsenceTypeService {
  async getAbsenceTypes(): Promise<AbsenceType[]> {
    const types = await bffJson("tenant", "GET /api/absence-types/", {
      errorMessage: "Abwesenheitsarten konnten nicht geladen werden",
    });
    return types.map(mapAbsenceType);
  }

  async createAbsenceType(
    name: string,
    config: {
      allowanceEnabled: boolean;
      carryoverUntil?: string | null;
      requestable?: boolean;
    },
  ): Promise<AbsenceType> {
    const type = await bffJson("tenant", "POST /api/absence-types/", {
      body: {
        name,
        allowance_enabled: config.allowanceEnabled,
        requestable: config.requestable ?? false,
        ...(config.carryoverUntil !== undefined
          ? { carryover_until: config.carryoverUntil ?? "" }
          : {}),
      },
      errorMessage: "Abwesenheitsart konnte nicht gespeichert werden",
    });
    return mapAbsenceType(type);
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
    const type = await bffJson("tenant", "PUT /api/absence-types/{id}", {
      params: { id },
      errorMessage: "Abwesenheitsart konnte nicht gespeichert werden",
      body: {
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
      },
    });
    return mapAbsenceType(type);
  }

  async getAllowance(
    absenceTypeId: string,
    staffId: string,
    year: number,
  ): Promise<AbsenceTypeAllowanceSummary> {
    const allowance = await bffJson(
      "tenant",
      "GET /api/absence-types/{id}/allowances/{staffId}",
      {
        params: { id: absenceTypeId, staffId },
        query: { year },
        errorMessage: "Kontingent konnte nicht gespeichert werden",
      },
    );
    return mapAllowance(allowance);
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
    const preview = await bffJson(
      "tenant",
      "GET /api/absence-types/{id}/allowances/{staffId}/preview",
      {
        params: { id: absenceTypeId, staffId },
        query: {
          date_start: booking.dateStart,
          date_end: booking.dateEnd,
          half_day: booking.halfDay,
        },
        errorMessage: "Die Vorschau konnte nicht berechnet werden",
      },
    );
    return {
      years: (preview.years ?? []).map(mapAllowance),
      blocked: preview.blocked,
      blockedBy: preview.blocked
        ? (knownEnum(BLOCKED_BY, preview.blocked_by) ?? "allowance")
        : null,
    };
  }

  async setAllowance(
    absenceTypeId: string,
    staffId: string,
    payload: { year: number; entitledDays: number; reason: string },
  ): Promise<AbsenceTypeAllowanceSummary> {
    const allowance = await bffJson(
      "tenant",
      "PUT /api/absence-types/{id}/allowances/{staffId}",
      {
        params: { id: absenceTypeId, staffId },
        body: {
          year: payload.year,
          entitled_days: payload.entitledDays,
          reason: payload.reason,
        },
        errorMessage: "Kontingent konnte nicht gespeichert werden",
      },
    );
    return mapAllowance(allowance);
  }
}

/** The previous year's rest as seen from the year it is carried into. */
interface AbsenceTypeAllowanceCarry {
  readonly year: number;
  readonly remainingDays: number;
  readonly expiredDays: number;
  readonly expiresOn: string;
}

const BLOCKED_BY = ["allowance", "school_limit"] as const;

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
  data: AllowanceSummaryResponse,
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
    expiredDays: data.expired_days,
    bookingDays: data.booking_days,
    carriedIn: data.carried_in
      ? {
          year: data.carried_in.year,
          remainingDays: data.carried_in.remaining_days,
          expiredDays: data.carried_in.expired_days,
          expiresOn: data.carried_in.expires_on,
        }
      : null,
    keptByTraeger: data.kept_by_traeger,
  };
}

export const absenceTypeService = new AbsenceTypeService();
