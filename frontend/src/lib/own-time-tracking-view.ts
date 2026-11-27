import type {
  OwnTimeAbsence,
  OwnTimeBlock,
  OwnTimeShift,
} from "~/lib/contract/time-tracking.generated";
import { ApiError } from "~/lib/api-error";
import { knownEnum } from "~/lib/contract/known-enum";
import type { StaffShift } from "~/lib/shift-helpers";
import type {
  StaffAbsence,
  WorkSession,
  WorkSessionHistory,
} from "~/lib/time-tracking-helpers";

export type ClockSession = Pick<
  WorkSession,
  | "id"
  | "date"
  | "status"
  | "source"
  | "checkInTime"
  | "checkOutTime"
  | "breakMinutes"
  | "notes"
  | "autoCheckedOut"
>;

export type OwnBlock = ClockSession &
  Pick<
    WorkSessionHistory,
    | "netMinutes"
    | "isOvertime"
    | "isBreakCompliant"
    | "breaks"
    | "editCount"
    | "auditCount"
    | "packUpMinutes"
    | "roundingMinutes"
    | "version"
  >;

export type OwnAbsence = Pick<
  StaffAbsence,
  | "id"
  | "absenceType"
  | "absenceTypeId"
  | "absenceTypeLabel"
  | "dateStart"
  | "dateEnd"
  | "halfDay"
  | "startHalfDay"
  | "endHalfDay"
  | "note"
  | "status"
  | "durationDays"
  | "workingDays"
  | "decisionNote"
  | "requestedAt"
>;

export type PlanShift = Pick<
  StaffShift,
  | "id"
  | "date"
  | "startTime"
  | "endTime"
  | "breakMinutes"
  | "shiftTypeColor"
  | "shiftTypeName"
  | "cancelled"
  | "changeReason"
  | "originShiftId"
>;

export function requireOwnDate(date: string | null): string {
  if (date === null) {
    throw new ApiError(
      "Missing calendar date in own time tracking",
      undefined,
      {
        code: "general.unavailable",
      },
    );
  }
  return date;
}

export function mapOwnBlock(block: OwnTimeBlock): OwnBlock {
  return {
    id: block.id,
    date: requireOwnDate(block.date),
    status: knownEnum(["present", "home_office"], block.status) ?? "present",
    source: knownEnum(["app", "nfc", "unknown"], block.source) ?? "unknown",
    checkInTime: block.check_in_time,
    checkOutTime: block.check_out_time,
    breakMinutes: block.break_minutes,
    notes: block.notes ?? "",
    autoCheckedOut: block.auto_checked_out,
    netMinutes: block.net_minutes,
    isOvertime: block.is_overtime,
    isBreakCompliant: block.is_break_compliant,
    editCount: block.edit_count,
    auditCount: block.audit_count,
    packUpMinutes: block.pack_up_minutes,
    roundingMinutes: block.rounding_minutes,
    version: block.version,
    breaks: (block.breaks ?? []).map((pause) => ({
      id: pause.id,
      sessionId: block.id,
      startedAt: pause.started_at,
      endedAt: pause.ended_at,
      durationMinutes: pause.duration_minutes,
      plannedEndTime: pause.planned_end_time,
    })),
  };
}

export function mapOwnAbsence(row: OwnTimeAbsence): OwnAbsence {
  return {
    id: row.id,
    absenceType: row.absence_type as StaffAbsence["absenceType"],
    absenceTypeId: row.absence_type_id,
    absenceTypeLabel: row.absence_type_label,
    dateStart: requireOwnDate(row.date_start),
    dateEnd: requireOwnDate(row.date_end),
    halfDay: row.half_day,
    startHalfDay: row.start_half_day,
    endHalfDay: row.end_half_day,
    note: row.note ?? "",
    status: row.status,
    durationDays: row.duration_days,
    workingDays: row.working_days ?? null,
    decisionNote: row.decision_note ?? "",
    requestedAt: row.requested_at,
  };
}

export function mapOwnShift(shift: OwnTimeShift): PlanShift {
  return {
    id: shift.id,
    date: requireOwnDate(shift.date),
    startTime: shift.start_time.slice(0, 5),
    endTime: shift.end_time.slice(0, 5),
    breakMinutes: shift.break_minutes,
    shiftTypeColor: shift.shift_type_color ?? null,
    shiftTypeName: shift.shift_type_name ?? null,
    cancelled: shift.cancelled,
    changeReason: shift.change_reason ?? null,
    originShiftId: shift.origin_shift_id ?? null,
  };
}
