// Time tracking API service for check-in/out and history management

import type * as shared from "~/lib/contract/shared.generated";
import type * as tt from "~/lib/contract/time-tracking.generated";
import type { ErrorCode } from "~/lib/error-codes.generated";
import { ApiError } from "~/lib/api-error";
import {
  DeviationReasonDetailsSchema,
  type DeviationReasonDetails,
} from "~/lib/contract/problem-details.generated";
import {
  knownMailOutcome,
  type MailOutcome,
  type MailOutcomeCounts,
} from "~/lib/email-delivery-status";
import { bffJson } from "./bff-fetch";
import {
  mapAllowance,
  type AbsenceTypeAllowanceSummary,
} from "./absence-type-api";
import type {
  DayProjection,
  HistoryResult,
  MonthSummary,
  StaffAbsence,
  WorkSession,
  WorkSessionBreak,
  WorkSessionEdit,
} from "./time-tracking-helpers";
import {
  mapClosingDaysResponse,
  mapDailyProjectionResponse,
  mapHistoryResponse,
  mapHolidaysResponse,
  mapMonthSummaryResponse,
  mapStaffAbsenceResponse,
  mapWorkSessionResponse,
  mapWorkSessionBreakResponse,
  mapWorkSessionEditResponse,
} from "./time-tracking-helpers";

export const PLANNED_START_NOT_REACHED_CODE: ErrorCode =
  "iot.planned_start_not_reached";
/**
 * Stable error code surfaced when a check-in/check-out deviates from the
 * planned shift window by more than the configured tolerance (F9). The page
 * prompts for a reason and retries the same stamp with `reason` set.
 */
export const DEVIATION_REASON_REQUIRED_CODE: ErrorCode =
  "iot.deviation_reason_required";

export function readStampDeviation(
  error: unknown,
): Partial<DeviationReasonDetails> | null {
  if (
    !(error instanceof ApiError) ||
    error.code !== DEVIATION_REASON_REQUIRED_CODE
  ) {
    return null;
  }
  const decoded = DeviationReasonDetailsSchema.safeParse(error.details);
  // Even a missing hint does not remove the required reason prompt.
  return decoded.success ? decoded.data : {};
}

/**
 * Update session request body
 */
export interface UpdateSessionRequest {
  date?: string;
  status?: "present" | "home_office";
  checkInTime?: string;
  checkOutTime?: string;
  breakMinutes?: number;
  notes?: string;
  breaks?: Array<{ id: string; durationMinutes: number }>;
  /** The version of the history row the dialog showed (ADR 0311). */
  expectedVersion: string;
}

/**
 * Body of POST /api/time-tracking/absences: the generated request with the
 * fields every new absence carries. With `absence_type_id` (school-defined
 * Abwesenheitsart, #2403) the backend takes the canonical absence_type from
 * the art itself, so the pair can never disagree.
 */
export type CreateAbsenceRequest = tt.OwnAbsenceRequest &
  Required<
    Pick<tt.OwnAbsenceRequest, "absence_type" | "date_start" | "date_end">
  >;

/** Body of POST /api/time-tracking/vacation/request. */
type VacationRequestPayload = Required<
  Pick<
    tt.RequestVacationRequest,
    "date_start" | "date_end" | "start_half_day" | "end_half_day"
  >
> &
  Pick<tt.RequestVacationRequest, "note" | "substitute_staff_id">;

interface TimeTrackingConfig {
  accountStartDate: string;
}

/**
 * Service class for time tracking API operations
 */
class TimeTrackingService {
  async checkIn(
    status: "present" | "home_office",
    reason?: string,
  ): Promise<WorkSession> {
    const session = await bffJson(
      "tenant",
      "POST /api/time-tracking/check-in",
      {
        body: reason ? { status, reason } : { status },
        errorMessage: "Failed to check in",
      },
    );
    return mapWorkSessionResponse(session);
  }

  async checkOut(reason?: string): Promise<WorkSession> {
    const session = await bffJson(
      "tenant",
      "POST /api/time-tracking/check-out",
      { body: reason ? { reason } : {}, errorMessage: "Failed to check out" },
    );
    return mapWorkSessionResponse(session);
  }

  async getCurrentSession(): Promise<WorkSession | null> {
    const session = await bffJson("tenant", "GET /api/time-tracking/current", {
      errorMessage: "Failed to get current session",
    });
    return session ? mapWorkSessionResponse(session) : null;
  }

  async getConfig(): Promise<TimeTrackingConfig> {
    const config = await bffJson("tenant", "GET /api/time-tracking/config", {
      errorMessage: "Failed to get time tracking config",
    });
    return { accountStartDate: config.account_start_date };
  }

  async getHistory(from: string, to: string): Promise<HistoryResult> {
    return mapHistoryResponse(
      await bffJson("tenant", "GET /api/time-tracking/history", {
        query: { from, to },
        errorMessage: "Failed to get history",
      }),
    );
  }

  // Own Monatskarte (#1842): Summe Soll/Ist, Gutschriften, Übertrag, Saldo.
  async getMonthSummary(year: number, month: number): Promise<MonthSummary> {
    return mapMonthSummaryResponse(
      await bffJson("tenant", "GET /api/time-tracking/month-summary", {
        query: { year, month },
        errorMessage: "Failed to get month summary",
      }),
    );
  }

  // Vollständige Tagesprojektion desselben Endpunkts (#2443): Soll, Gutschrift,
  // Ist und Saldo je Tag, gerechnet wie die Monatskarte. Die Tagestabelle liest
  // diese Werte, statt den Saldo selbst abzuleiten.
  async getDailyProjection(
    from: string,
    to: string,
  ): Promise<ReadonlyMap<string, DayProjection>> {
    return mapDailyProjectionResponse(
      await bffJson("tenant", "GET /api/time-tracking/schedule-targets", {
        query: { from, to },
        errorMessage: "Failed to get daily projection",
      }),
    );
  }

  // Gesetzliche Feiertage des Tenants (#1418 3a), keyed YYYY-MM-DD → Name.
  // Tenant-global (Bundesland-Setting), daher kein Staff-Parameter — die
  // Admin-Detailansicht nutzt denselben Endpunkt.
  async getHolidays(
    from: string,
    to: string,
  ): Promise<ReadonlyMap<string, string>> {
    return mapHolidaysResponse(
      await bffJson("tenant", "GET /api/time-tracking/holidays", {
        query: { from, to },
        errorMessage: "Failed to get holidays",
      }),
    );
  }

  // OGS-Schließtage des Tenants (#1418 3b), keyed YYYY-MM-DD → Grund.
  // Tenant-global wie die Feiertage; das Backend liefert Zeiträume, der
  // Mapper expandiert sie tageweise.
  async getClosingDays(
    from: string,
    to: string,
  ): Promise<ReadonlyMap<string, string>> {
    return mapClosingDaysResponse(
      await bffJson("tenant", "GET /api/time-tracking/closing-days", {
        query: { from, to },
        errorMessage: "Failed to get closing days",
      }),
      from,
      to,
    );
  }

  async updateSession(
    id: string,
    updates: UpdateSessionRequest,
  ): Promise<WorkSession> {
    const session = await bffJson("tenant", "PUT /api/time-tracking/{id}", {
      params: { id },
      body: {
        date: updates.date,
        check_in_time: updates.checkInTime,
        check_out_time: updates.checkOutTime,
        break_minutes: updates.breakMinutes,
        status: updates.status,
        notes: updates.notes,
        expected_version: updates.expectedVersion,
        ...(updates.breaks && updates.breaks.length > 0
          ? {
              breaks: updates.breaks.map((b) => ({
                id: b.id,
                duration_minutes: b.durationMinutes,
              })),
            }
          : {}),
      },
      errorMessage: "Failed to update session",
    });
    return mapWorkSessionResponse(session);
  }

  async startBreak(durationMinutes?: number): Promise<WorkSessionBreak> {
    const started = await bffJson(
      "tenant",
      "POST /api/time-tracking/break/start",
      {
        body: durationMinutes
          ? { planned_duration_minutes: durationMinutes }
          : {},
        errorMessage: "Failed to start break",
      },
    );
    return mapWorkSessionBreakResponse(started);
  }

  async endBreak(): Promise<WorkSession> {
    const session = await bffJson(
      "tenant",
      "POST /api/time-tracking/break/end",
      { errorMessage: "Failed to end break" },
    );
    return mapWorkSessionResponse(session);
  }

  async getSessionBreaks(sessionId: string): Promise<WorkSessionBreak[]> {
    const breaks = await bffJson(
      "tenant",
      "GET /api/time-tracking/breaks/{sessionId}",
      { params: { sessionId }, errorMessage: "Failed to get breaks" },
    );
    return (breaks ?? []).map(mapWorkSessionBreakResponse);
  }

  async getSessionEdits(sessionId: string): Promise<WorkSessionEdit[]> {
    const edits = await bffJson("tenant", "GET /api/time-tracking/{id}/edits", {
      params: { id: sessionId },
      errorMessage: "Failed to get edits",
    });
    return (edits ?? []).map(mapWorkSessionEditResponse);
  }

  async getAbsences(from: string, to: string): Promise<StaffAbsence[]> {
    const absences = await bffJson(
      "tenant",
      "GET /api/time-tracking/absences",
      { query: { from, to }, errorMessage: "Failed to get absences" },
    );
    return (absences ?? []).map(mapStaffAbsenceResponse);
  }

  async getQuestionedAbsences(): Promise<StaffAbsence[]> {
    const absences = await bffJson(
      "tenant",
      "GET /api/time-tracking/absences",
      {
        query: { status: "question" },
        errorMessage: "Failed to get questioned absences",
      },
    );
    return (absences ?? []).map(mapStaffAbsenceResponse);
  }

  /**
   * Ob die Leitung die eigenen offenen Anträge per Mail bekam (#7058): je
   * Antrag die Mails der letzten Meldung, nach Ergebnis gezählt. Ein Antrag
   * ohne Mail fehlt.
   */
  async getAbsenceRequestMails(): Promise<Record<string, MailOutcomeCounts>> {
    const mails = await bffJson(
      "tenant",
      "GET /api/time-tracking/absences/mails",
      { errorMessage: "Failed to get absence request mails" },
    );
    // Counts per outcome; an outcome this build does not know is left out.
    const byAbsence: Record<string, MailOutcomeCounts> = {};
    for (const [id, counts] of Object.entries(mails?.absences ?? {})) {
      if (!counts) continue;
      const known: Partial<Record<MailOutcome, number>> = {};
      for (const [key, count] of Object.entries(counts)) {
        const outcome = knownMailOutcome(key);
        if (outcome) known[outcome] = count;
      }
      byAbsence[id] = known;
    }
    return byAbsence;
  }

  async createAbsence(req: CreateAbsenceRequest): Promise<StaffAbsence> {
    const absence = await bffJson(
      "tenant",
      "POST /api/time-tracking/absences",
      { body: req, errorMessage: "Failed to create absence" },
    );
    return mapStaffAbsenceResponse(absence);
  }

  async updateAbsence(
    id: string,
    req: tt.UpdateAbsenceRequest,
  ): Promise<StaffAbsence> {
    const absence = await bffJson(
      "tenant",
      "PUT /api/time-tracking/absences/{id}",
      { params: { id }, body: req, errorMessage: "Failed to update absence" },
    );
    return mapStaffAbsenceResponse(absence);
  }

  async deleteAbsence(id: string): Promise<void> {
    await bffJson("tenant", "DELETE /api/time-tracking/absences/{id}", {
      params: { id },
      errorMessage: "Failed to delete absence",
    });
  }

  async requestVacation(req: VacationRequestPayload): Promise<StaffAbsence> {
    const absence = await bffJson(
      "tenant",
      "POST /api/time-tracking/vacation/request",
      {
        body: req,
        errorMessage: "Urlaubsantrag konnte nicht erstellt werden",
      },
    );
    return mapStaffAbsenceResponse(absence);
  }

  async cancelAbsence(id: string): Promise<void> {
    await bffJson("tenant", "POST /api/time-tracking/absences/{id}/cancel", {
      params: { id },
      errorMessage: "Antrag konnte nicht storniert werden",
    });
  }

  // Answer to a Rückfrage (#1419): amend the own note and move the absence
  // back to "requested" for another decision round.
  async resubmitAbsence(id: string, note: string): Promise<void> {
    await bffJson("tenant", "POST /api/time-tracking/absences/{id}/resubmit", {
      params: { id },
      body: { note },
      errorMessage: "Antrag konnte nicht erneut eingereicht werden",
    });
  }

  async getVacationQuota(year?: number): Promise<shared.VacationQuotaSummary> {
    return bffJson("tenant", "GET /api/time-tracking/vacation/quota", {
      query: { year },
      errorMessage: "Urlaubskontingent konnte nicht geladen werden",
    });
  }

  /**
   * The staff member's own Kontingente of the school's absence types (#4971),
   * read-only. The backend takes the person from the session and the current
   * Berlin year when none is given.
   */
  async getOwnAbsenceAllowances(): Promise<OwnAbsenceAllowance[]> {
    const allowances = await bffJson(
      "tenant",
      "GET /api/time-tracking/absence-allowances",
      { errorMessage: "Kontingente konnten nicht geladen werden" },
    );
    return (allowances ?? []).map((entry) => ({
      name: entry.name,
      summary: mapAllowance(entry),
    }));
  }
}

/** One school-defined absence type with an allowance and its yearly account. */
export interface OwnAbsenceAllowance {
  readonly name: string;
  readonly summary: AbsenceTypeAllowanceSummary;
}

export const timeTrackingService = new TimeTrackingService();
