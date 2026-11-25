import type { PlanShift } from "./own-time-tracking-view";
import type { StaffAbsenceRow, StaffHistorySession } from "./staff-api";
import type { BalanceAdjustment } from "./time-tracking-helpers";

// The charts need intervals and absence boundaries, not HR notes, actors or
// correction tokens. These are the values of the overview-only cache keys.
export type OverviewSession = Pick<
  StaffHistorySession,
  | "date"
  | "status"
  | "check_in_time"
  | "check_out_time"
  | "break_minutes"
  | "net_minutes"
  | "breaks"
>;

export function overviewSession(row: OverviewSession): OverviewSession {
  return {
    date: row.date,
    status: row.status,
    check_in_time: row.check_in_time,
    check_out_time: row.check_out_time,
    break_minutes: row.break_minutes,
    net_minutes: row.net_minutes,
    breaks: row.breaks?.map((item) => ({
      started_at: item.started_at,
      ended_at: item.ended_at,
    })),
  };
}

export type OverviewAbsence = Pick<
  StaffAbsenceRow,
  | "absence_type"
  | "status"
  | "date_start"
  | "date_end"
  | "half_day"
  | "start_half_day"
  | "end_half_day"
>;

export function overviewAbsence(row: OverviewAbsence): OverviewAbsence {
  return {
    absence_type: row.absence_type,
    status: row.status,
    date_start: row.date_start,
    date_end: row.date_end,
    half_day: row.half_day,
    start_half_day: row.start_half_day,
    end_half_day: row.end_half_day,
  };
}

// The weekly table uses plan slots and their cancellation explanations, not
// the planner's notes, series metadata or edit versions.
export function staffTableShift(shift: PlanShift): PlanShift {
  return {
    id: shift.id,
    date: shift.date,
    startTime: shift.startTime,
    endTime: shift.endTime,
    breakMinutes: shift.breakMinutes,
    shiftTypeName: shift.shiftTypeName,
    shiftTypeColor: shift.shiftTypeColor,
    cancelled: shift.cancelled,
    changeReason: shift.changeReason,
    originShiftId: shift.originShiftId,
  };
}

export type StaffBalanceEntry = Omit<
  BalanceAdjustment,
  "decidedBy" | "decidedAt"
>;

export function staffBalanceEntry(row: StaffBalanceEntry): StaffBalanceEntry {
  return {
    id: row.id,
    type: row.type,
    minutesDelta: row.minutesDelta,
    effectiveDate: row.effectiveDate,
    note: row.note,
  };
}
