// API clients for planned staff shifts (Dienstplan, #1376 core slice).
// Admin CRUD, the series rule and its end go through /api/staff-shifts
// (time_tracking:manage) and the catalog proxy. Staff read their own shifts
// via /api/time-tracking/shifts (time_tracking:own).

import { bffJson } from "./bff-fetch";
import type * as staffShiftsContract from "./contract/staff-shifts.generated";
import {
  mapBreakDayShift,
  mapOwnAssignment,
  mapStaffScheduleOverview,
  mapStaffShift,
  type BreakDayShift,
  type OwnAssignment,
  type StaffScheduleOverview,
  type StaffShift,
} from "./shift-helpers";
import { workingTimeBody, type WorkingTimeConfirmation } from "./working-time";

interface ShiftPayload {
  staffId: string;
  /** "YYYY-MM-DD" */
  date: string;
  /** "HH:MM" */
  startTime: string;
  /** "HH:MM" */
  endTime: string;
  breakMinutes: number;
  /** Id of the linked shift type (Schichtart), or null if untyped */
  shiftTypeId: string | null;
  /** Optional free-form shift note. Omitted updates preserve the stored note. */
  notes?: string;
  /** The shift does not take place (staff absent / gap left open, #1841). */
  cancelled?: boolean;
  /** Optional "why" for a flexible daily change (#1841). Sent verbatim, so the
   *  saved value always matches what the admin sees; "" or null clears it. */
  changeReason?: string | null;
  /** Id of the shift this one covers as a replacement (#1841). Create-only. */
  originShiftId?: string | null;
  /** Answer to the working-time warnings of a refused save (#4708). */
  workingTime?: WorkingTimeConfirmation;
  /** The version of the shift an edit replaces (ADR 0311). Create-ignored. */
  expectedVersion?: string;
}

interface MoveShiftPayload {
  sourceStaffId: string;
  targetStaffId: string;
  /** "YYYY-MM-DD" */
  date: string;
  /** "HH:MM" */
  startTime: string;
  /** "HH:MM" */
  endTime: string;
  breakMinutes: number;
  shiftTypeId: string | null;
  /** Answer to the working-time warnings of a refused save (#4708). */
  workingTime?: WorkingTimeConfirmation;
  /** The version of the shift the planner moved (ADR 0311). */
  expectedVersion: string;
}

/** One replacement (Vertretung) covering part of a cancelled shift's gap. */
interface ReplacementPayload {
  staffId: string;
  /** "HH:MM" */
  startTime: string;
  /** "HH:MM" */
  endTime: string;
  breakMinutes: number;
  shiftTypeId: string | null;
}

/** Atomic cancel/reactivate + replacement-set change for one shift (#1841).
 *  The backend applies the origin flag flip and the whole replacement set in a
 *  single transaction, so a partial failure never leaves a half-changed plan. */
interface CancellationPayload {
  cancelled: boolean;
  /** Sent verbatim ("" clears the stored reason). */
  changeReason: string;
  /** The origin shift's own window/type as edited in the modal. Sent alongside
   *  the cancellation so a time/type change made in the same save is applied to
   *  the origin instead of being discarded, and a reactivation re-checks overlap
   *  against the edited window (#1841). "HH:MM". */
  startTime: string;
  endTime: string;
  breakMinutes: number;
  shiftTypeId: string | null;
  /** Only meaningful when cancelling; ignored (must be empty) on reactivation. */
  replacements: ReplacementPayload[];
  /** Answer to the working-time warnings of a refused save (#4708). */
  workingTime?: WorkingTimeConfirmation;
  /** The version of the shift and of every cover the planner read, by shift
   *  id (ADR 0311): the covers are rebuilt from this request. */
  expectedVersion: string;
  expectedReplacementVersions: Readonly<Record<string, string>>;
}

interface SeriesPayload {
  staffId: string;
  /** ISO weekdays, 1 = Montag … 7 = Sonntag */
  weekdays: number[];
  /** "HH:MM" */
  startTime: string;
  /** "HH:MM" */
  endTime: string;
  breakMinutes: number;
  shiftTypeId: string | null;
  calendarPeriodId: string;
  /** 0 = jede Woche, 1 = Woche A, 2 = Woche B */
  weekPattern: number;
  /** "YYYY-MM-DD" */
  validFrom: string;
  /** "YYYY-MM-DD", exclusive; null = bis Periodenende */
  validUntil: string | null;
  /** Also plan in the Ferien and on closing days; holidays stay free (#3820). */
  includeSchoolBreaks: boolean;
  /** Answer to the working-time warnings of a refused save (#4708). */
  workingTime?: WorkingTimeConfirmation;
}

/** Edited fields applied from the effective date on ("Ab jetzt dauerhaft" and
 *  the series editor). Omitted optional fields inherit the predecessor's
 *  value, so editing only the times never has to re-send the rhythm (#2028). */
interface SeriesSplitPayload {
  /** "YYYY-MM-DD" */
  effectiveDate: string;
  /** Concrete occurrence opened by the planner. If it is today, the backend
   * updates this row in place and only re-plans the series from tomorrow. */
  occurrenceShiftId?: string;
  /** Version of that occurrence as the modal shows it (ADR 0311): a split
   *  effective today rewrites it in place and refuses it when it changed. */
  expectedOccurrenceVersion?: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  shiftTypeId: string | null;
  /** ISO weekdays; omitted keeps the days the series already runs on. */
  weekdays?: number[];
  /** 0 = jede Woche, 1 = Woche A, 2 = Woche B; omitted keeps the rhythm. */
  weekPattern?: number;
  /** "YYYY-MM-DD", exclusive. Omitted keeps the stored end, null runs the
   *  series to the end of the calendar period. */
  validUntil?: string | null;
  /** Ferien and closing days opt-in (#3820); omitted keeps the stored one. */
  includeSchoolBreaks?: boolean;
  /** Answer to the working-time warnings of a refused save (#4708). */
  workingTime?: WorkingTimeConfirmation;
  /** Version of the series the planner read (ADR 0311); the split refuses
   *  a series changed since. */
  expectedVersion: string;
}

/** The stored rule behind a series shift — weekdays, rhythm, window, and
 *  validity. The series editor loads it and writes changes back through
 *  splitSeries, so they apply from the opened occurrence onwards (#2028). */
export interface SeriesRule {
  id: string;
  staffId: string;
  /** ISO weekdays, 1 = Montag … 7 = Sonntag */
  weekdays: number[];
  startTime: string;
  endTime: string;
  breakMinutes: number;
  shiftTypeId: string | null;
  calendarPeriodId: string;
  weekPattern: number;
  /** "YYYY-MM-DD" */
  validFrom: string;
  /** "YYYY-MM-DD", exclusive; null = bis Periodenende */
  validUntil: string | null;
  /** Also planned in the Ferien and on closing days (#3820). */
  includeSchoolBreaks: boolean;
  /** Token of the stored series; an edit sends it back (ADR 0311). */
  version: string;
}

export interface SeriesResult {
  seriesId: string;
  created: number;
  /** Days skipped because an existing shift would overlap ("YYYY-MM-DD") */
  skippedDates: string[];
  /** Occurrences left out on holidays, Ferien days and closing days (#3820) */
  skippedNonWorkingDays: number;
}

function mapSeriesRule(
  data: staffShiftsContract.SeriesDetailResponse,
): SeriesRule {
  return {
    id: data.id,
    staffId: data.staff_id,
    weekdays: data.weekdays ?? [],
    startTime: data.start_time,
    endTime: data.end_time,
    breakMinutes: data.break_minutes,
    shiftTypeId: data.shift_type_id,
    calendarPeriodId: data.calendar_period_id,
    weekPattern: data.week_pattern,
    validFrom: data.valid_from,
    validUntil: data.valid_until,
    includeSchoolBreaks: data.include_school_breaks,
    version: data.version,
  };
}

function toBackendBody(
  payload: ShiftPayload,
): staffShiftsContract.ShiftRequest {
  // The flexible-change fields are only sent when they carry meaning, so a
  // plain create/edit stays byte-for-byte the classic Dienstplan body (#1841):
  //  - cancelled omitted → the backend treats it as false (no absence)
  //  - change_reason sent whenever supplied (incl. ""), so the stored reason
  //    mirrors the field; omitted leaves the stored reason untouched on update
  //  - origin_shift_id sent only for a replacement shift
  return {
    staff_id: payload.staffId,
    date: payload.date,
    start_time: payload.startTime,
    end_time: payload.endTime,
    break_minutes: payload.breakMinutes,
    shift_type_id: payload.shiftTypeId,
    ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
    ...(payload.cancelled ? { cancelled: true } : {}),
    ...(payload.changeReason !== undefined
      ? { change_reason: payload.changeReason }
      : {}),
    ...(payload.expectedVersion !== undefined
      ? { expected_version: payload.expectedVersion }
      : {}),
    ...(payload.originShiftId != null
      ? { origin_shift_id: payload.originShiftId }
      : {}),
    ...workingTimeBody(payload.workingTime),
  };
}

class StaffShiftService {
  async getShifts(from: string, to: string): Promise<StaffShift[]> {
    const rows = await bffJson("tenant", "GET /api/staff-shifts/", {
      query: { from, to },
      errorMessage: "Schichten konnten nicht geladen werden",
    });
    return (rows ?? []).map(mapStaffShift);
  }

  /** One staff member's planned shifts in the range — backs the admin
   *  Plan|Ist|Grund detail view (#1844). Uses the backend staff_id filter. */
  async getShiftsForStaff(
    staffId: string,
    from: string,
    to: string,
  ): Promise<StaffShift[]> {
    const rows = await bffJson("tenant", "GET /api/staff-shifts/", {
      query: { staff_id: staffId, from, to },
      errorMessage: "Schichten konnten nicht geladen werden",
    });
    return (rows ?? []).map(mapStaffShift);
  }

  /** Serienschichten, die an einem Schließtag oder in den Ferien stehen (#8205). */
  async listBreakDayShifts(): Promise<BreakDayShift[]> {
    const rows = await bffJson(
      "tenant",
      "GET /api/staff-shifts/break-day-shifts",
      {
        errorMessage: "Schichten an Schließtagen konnten nicht geladen werden",
      },
    );
    return (rows ?? []).map(mapBreakDayShift);
  }

  async getOverview(from: string, to: string): Promise<StaffScheduleOverview> {
    return mapStaffScheduleOverview(
      await bffJson("tenant", "GET /api/staff-shifts/overview", {
        query: { from, to },
        errorMessage: "Dienstplan konnte nicht geladen werden",
      }),
    );
  }

  async createShift(payload: ShiftPayload): Promise<StaffShift> {
    return mapStaffShift(
      await bffJson("tenant", "POST /api/staff-shifts/", {
        body: toBackendBody(payload),
        errorMessage: "Schicht konnte nicht gespeichert werden",
      }),
    );
  }

  async updateShift(
    shiftId: string,
    payload: ShiftPayload,
  ): Promise<StaffShift> {
    return mapStaffShift(
      await bffJson("tenant", "PUT /api/staff-shifts/{id}", {
        params: { id: shiftId },
        body: toBackendBody(payload),
        errorMessage: "Schicht konnte nicht gespeichert werden",
      }),
    );
  }

  /** Atomically move one concrete shift while preserving its row identity. */
  async moveShift(
    shiftId: string,
    payload: MoveShiftPayload,
  ): Promise<StaffShift> {
    return mapStaffShift(
      await bffJson("tenant", "PUT /api/staff-shifts/{id}/move", {
        params: { id: shiftId },
        body: {
          source_staff_id: payload.sourceStaffId,
          target_staff_id: payload.targetStaffId,
          date: payload.date,
          start_time: payload.startTime,
          end_time: payload.endTime,
          break_minutes: payload.breakMinutes,
          shift_type_id: payload.shiftTypeId,
          expected_version: payload.expectedVersion,
          ...workingTimeBody(payload.workingTime),
        },
        errorMessage: "Schicht konnte nicht gespeichert werden",
      }),
    );
  }

  async deleteShift(shiftId: string): Promise<void> {
    await bffJson("tenant", "DELETE /api/staff-shifts/{id}", {
      params: { id: shiftId },
      errorMessage: "Schicht konnte nicht gelöscht werden",
    });
  }

  /** Atomically cancel/reactivate a shift and rebuild its replacement set. */
  async applyCancellation(
    shiftId: string,
    payload: CancellationPayload,
  ): Promise<void> {
    await bffJson("tenant", "PUT /api/staff-shifts/{id}/cancellation", {
      params: { id: shiftId },
      body: {
        cancelled: payload.cancelled,
        change_reason: payload.changeReason,
        start_time: payload.startTime,
        end_time: payload.endTime,
        break_minutes: payload.breakMinutes,
        shift_type_id: payload.shiftTypeId,
        replacements: payload.replacements.map((r) => ({
          staff_id: r.staffId,
          start_time: r.startTime,
          end_time: r.endTime,
          break_minutes: r.breakMinutes,
          shift_type_id: r.shiftTypeId,
        })),
        expected_version: payload.expectedVersion,
        expected_replacement_versions: {
          ...payload.expectedReplacementVersions,
        },
        ...workingTimeBody(payload.workingTime),
      },
      errorMessage: "Änderung konnte nicht gespeichert werden",
    });
  }
}

const SERIES_SAVE_FAILED = "Schicht-Serie konnte nicht gespeichert werden";

function mapSeriesResult(
  data: staffShiftsContract.SeriesResponse,
): SeriesResult {
  return {
    seriesId: data.series_id,
    created: data.created,
    skippedDates: data.skipped_dates ?? [],
    skippedNonWorkingDays: data.skipped_non_working_days,
  };
}

class StaffShiftSeriesService {
  async createSeries(payload: SeriesPayload): Promise<SeriesResult> {
    return mapSeriesResult(
      await bffJson("tenant", "POST /api/staff-shifts/series", {
        body: {
          staff_id: payload.staffId,
          weekdays: payload.weekdays,
          start_time: payload.startTime,
          end_time: payload.endTime,
          break_minutes: payload.breakMinutes,
          shift_type_id: payload.shiftTypeId,
          calendar_period_id: payload.calendarPeriodId,
          week_pattern: payload.weekPattern,
          valid_from: payload.validFrom,
          valid_until: payload.validUntil,
          include_school_breaks: payload.includeSchoolBreaks,
          ...workingTimeBody(payload.workingTime),
        },
        errorMessage: SERIES_SAVE_FAILED,
      }),
    );
  }

  async splitSeries(
    seriesId: string,
    payload: SeriesSplitPayload,
  ): Promise<SeriesResult> {
    return mapSeriesResult(
      await bffJson("tenant", "PUT /api/staff-shifts/series/{id}/split", {
        params: { id: seriesId },
        body: {
          effective_date: payload.effectiveDate,
          ...(payload.occurrenceShiftId !== undefined
            ? {
                occurrence_shift_id: payload.occurrenceShiftId,
                expected_occurrence_version:
                  payload.expectedOccurrenceVersion ?? "",
              }
            : {}),
          start_time: payload.startTime,
          end_time: payload.endTime,
          break_minutes: payload.breakMinutes,
          shift_type_id: payload.shiftTypeId,
          // Only sent when the caller actually edited the rule: an absent key
          // means "keep what the series already has" on the backend.
          ...(payload.weekdays !== undefined
            ? { weekdays: payload.weekdays }
            : {}),
          ...(payload.weekPattern !== undefined
            ? { week_pattern: payload.weekPattern }
            : {}),
          ...(payload.validUntil !== undefined
            ? { valid_until: payload.validUntil }
            : {}),
          ...(payload.includeSchoolBreaks !== undefined
            ? { include_school_breaks: payload.includeSchoolBreaks }
            : {}),
          ...workingTimeBody(payload.workingTime),
          expected_version: payload.expectedVersion,
        },
        errorMessage: SERIES_SAVE_FAILED,
      }),
    );
  }

  /** The stored rule behind a series shift, so the modal can show and edit
   *  weekdays, rhythm, and validity instead of only one occurrence (#2028). */
  async getSeries(seriesId: string): Promise<SeriesRule> {
    return mapSeriesRule(
      await bffJson("tenant", "GET /api/staff-shifts/series/{id}", {
        params: { id: seriesId },
        errorMessage: "Serie konnte nicht geladen werden",
      }),
    );
  }

  async endSeries(seriesId: string, from: string): Promise<void> {
    await bffJson("tenant", "DELETE /api/staff-shifts/series/{id}", {
      params: { id: seriesId },
      query: { from },
      errorMessage: "Schicht-Serie konnte nicht beendet werden",
    });
  }
}

class OwnShiftService {
  async getOwnShifts(from: string, to: string): Promise<StaffShift[]> {
    const rows = await bffJson("tenant", "GET /api/time-tracking/shifts", {
      query: { from, to },
      errorMessage: "Schichten konnten nicht geladen werden",
    });
    return (rows ?? []).map(mapStaffShift);
  }

  /** The staff member's own Betreuungsplan blocks (Ort/Aufgabe + Vertretungen)
   *  for the range — "Mein Tag" (#1844). */
  async getOwnAssignments(from: string, to: string): Promise<OwnAssignment[]> {
    const rows = await bffJson("tenant", "GET /api/time-tracking/assignments", {
      query: { from, to },
      errorMessage: "Einsätze konnten nicht geladen werden",
    });
    return (rows ?? []).map(mapOwnAssignment);
  }
}

export const staffShiftService = new StaffShiftService();
export const staffShiftSeriesService = new StaffShiftSeriesService();
export const ownShiftService = new OwnShiftService();
