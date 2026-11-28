// Types and mapping helpers for planned staff shifts (Dienstplan, #1376).
// Wire shapes: lib/contract/{shared,staff-shifts,time-tracking}.generated.ts.

import { knownEnum } from "./contract/known-enum";
import type { ShiftResponse } from "./contract/shared.generated";
import type {
  OverviewResponse,
  SeriesBreakDayShift,
} from "./contract/staff-shifts.generated";
import type { assignmentResponse } from "./contract/time-tracking.generated";

export interface StaffShift {
  id: string;
  staffId: string;
  /** Calendar day as "YYYY-MM-DD" */
  date: string;
  /** Wall-clock "HH:MM" */
  startTime: string;
  /** Wall-clock "HH:MM" */
  endTime: string;
  breakMinutes: number;
  /** Id of the linked shift type (Schichtart), or null if untyped */
  shiftTypeId: string | null;
  /** Resolved Schichtart label (#1844), or null when untyped. */
  shiftTypeName: string | null;
  /** Resolved Schichtart color as "#RRGGBB" (#1844), or null when untyped. */
  shiftTypeColor: string | null;
  notes: string;
  /** Id of the shift series this row was materialized from (#1889), or null
   *  for a standalone shift. */
  seriesId: string | null;
  /** Original recurrence slot for a moved series occurrence, or null for a
   * standalone shift. */
  seriesOccurrenceDate?: string | null;
  /** True when the row was edited via "Nur diese Woche" — series re-plans
   *  leave it alone. */
  detached: boolean;
  /** True when the shift does not take place: the staff member is absent or
   *  the gap is deliberately left open (#1841). Excluded from planned minutes. */
  cancelled: boolean;
  /** Optional "why" for a flexible daily change (moved times, cancellation, or
   *  replacement, #1841). */
  changeReason: string | null;
  /** When set, this shift covers another (cancelled) shift as a replacement;
   *  several replacements sharing one origin split a gap across people (#1841). */
  /** The Personalverwaltung of the Träger planned the shift (#4708). */
  plannedByTraeger?: boolean;
  originShiftId: string | null;
  /** The stored state an edit, a move or a cancellation sends back (ADR
   *  0311). */
  version?: string;
}

type CoverageStatus = "covered" | "uncovered" | "not_applicable";

type CoverageReason = "absent" | "dienstplan_not_used" | null;

interface UncoveredInterval {
  /** Wall-clock "HH:MM" */
  startTime: string;
  /** Wall-clock "HH:MM" */
  endTime: string;
}

export interface StaffScheduleStaff {
  id: string;
  firstName: string;
  lastName: string;
}

export interface StaffScheduleAssignment {
  instanceId: string;
  staffId: string;
  /** Calendar day as "YYYY-MM-DD" */
  date: string;
  /** Wall-clock "HH:MM" */
  startTime: string;
  /** Wall-clock "HH:MM" */
  endTime: string;
  activityTitle: string;
  /** The effective room for this concrete staff assignment. */
  roomId: string;
  /** The effective room for this concrete staff assignment. */
  roomName: string;
  status: string;
  isAbsent: boolean;
  isSubstitute: boolean;
  absenceReason: string | null;
  coverageStatus: CoverageStatus;
  coverageReason: CoverageReason;
  uncoveredIntervals: UncoveredInterval[];
}

interface ShiftTypeMinutes {
  /** Schichtart id, or null for shifts without a Schichtart. */
  shiftTypeId: string | null;
  plannedMinutes: number;
}

export interface StaffWeeklySummary {
  staffId: string;
  /** Monday of the summarized calendar week as "YYYY-MM-DD". */
  weekStart: string;
  /** Net shift minutes (span minus break) planned in that week. */
  plannedMinutes: number;
  /** Contractual weekly minutes (Arbeitszeitmodell); null when none resolves. */
  targetMinutes: number | null;
  /** plannedMinutes - targetMinutes; null when targetMinutes is null. */
  deltaMinutes: number | null;
  /** plannedMinutes split by Schichtart; the entries add up to it. */
  plannedByShiftType: ShiftTypeMinutes[];
}

export interface StaffScheduleOverview {
  /** Inclusive calendar-day range start as "YYYY-MM-DD". */
  from: string;
  /** Inclusive calendar-day range end as "YYYY-MM-DD". */
  to: string;
  dienstplanInUse: boolean;
  dienstplanUsedWeeks: string[];
  staff: StaffScheduleStaff[];
  shifts: StaffShift[];
  assignments: StaffScheduleAssignment[];
  weeklySummaries: StaffWeeklySummary[];
}

const COVERAGE_STATUSES: readonly CoverageStatus[] = [
  "covered",
  "uncovered",
  "not_applicable",
];
const COVERAGE_REASONS: readonly NonNullable<CoverageReason>[] = [
  "absent",
  "dienstplan_not_used",
];

export function mapStaffShift(data: ShiftResponse): StaffShift {
  return {
    id: data.id,
    staffId: data.staff_id,
    date: data.date.slice(0, 10),
    startTime: data.start_time.slice(0, 5),
    endTime: data.end_time.slice(0, 5),
    breakMinutes: data.break_minutes,
    shiftTypeId: data.shift_type_id ?? null,
    shiftTypeName: data.shift_type_name ?? null,
    shiftTypeColor: data.shift_type_color ?? null,
    notes: data.notes ?? "",
    seriesId: data.series_id ?? null,
    ...(data.series_occurrence_date != null
      ? { seriesOccurrenceDate: data.series_occurrence_date.slice(0, 10) }
      : {}),
    detached: data.detached,
    cancelled: data.cancelled,
    changeReason: data.change_reason ?? null,
    originShiftId: data.origin_shift_id ?? null,
    ...(data.planned_by_traeger ? { plannedByTraeger: true } : {}),
    ...(data.version ? { version: data.version } : {}),
  };
}

export function mapStaffScheduleOverview(
  data: OverviewResponse,
): StaffScheduleOverview {
  return {
    from: data.from.slice(0, 10),
    to: data.to.slice(0, 10),
    dienstplanInUse: data.dienstplan_in_use,
    dienstplanUsedWeeks: (data.dienstplan_used_weeks ?? []).map((week) =>
      week.slice(0, 10),
    ),
    staff: (data.staff ?? []).map((member) => ({
      id: member.id,
      firstName: member.first_name,
      lastName: member.last_name,
    })),
    shifts: (data.shifts ?? []).map(mapStaffShift),
    assignments: (data.assignments ?? []).map((assignment) => ({
      instanceId: assignment.instance_id,
      staffId: assignment.staff_id,
      date: assignment.date.slice(0, 10),
      startTime: assignment.start_time.slice(0, 5),
      endTime: assignment.end_time.slice(0, 5),
      activityTitle: assignment.activity_title,
      roomId: assignment.room_id,
      roomName: assignment.room_name,
      status: assignment.status,
      isAbsent: assignment.is_absent,
      isSubstitute: assignment.is_substitute,
      absenceReason: assignment.absence_reason,
      coverageStatus:
        knownEnum(COVERAGE_STATUSES, assignment.coverage_status) ??
        "not_applicable",
      coverageReason:
        knownEnum(COVERAGE_REASONS, assignment.coverage_reason ?? undefined) ??
        null,
      uncoveredIntervals: (assignment.uncovered_intervals ?? []).map(
        (interval) => ({
          startTime: interval.start_time.slice(0, 5),
          endTime: interval.end_time.slice(0, 5),
        }),
      ),
    })),
    weeklySummaries: (data.weekly_summaries ?? []).map((summary) => ({
      staffId: summary.staff_id,
      weekStart: summary.week_start.slice(0, 10),
      plannedMinutes: summary.planned_minutes,
      targetMinutes: summary.target_minutes,
      deltaMinutes: summary.delta_minutes,
      plannedByShiftType: (summary.planned_by_shift_type ?? []).map(
        (entry) => ({
          shiftTypeId: entry.shift_type_id,
          plannedMinutes: entry.planned_minutes,
        }),
      ),
    })),
  };
}

// ─── Own Betreuungsplan assignments ("Mein Tag", #1844) ─────────────────────
// The self-scoped GET /api/time-tracking/assignments shape. Distinct from the
// admin StaffScheduleAssignment above (that one carries coverage math against
// the Dienstplan; this one carries the block-level Vertretungsplan state a
// staff member sees for their own day).

export interface OwnAssignment {
  instanceId: string;
  /** Block title (activity instance title). */
  title: string;
  /** Activity/Betreuungsgruppe name, or null for a spontaneous block. */
  groupName: string | null;
  /** Effective room name for this block, or "" when unresolved. */
  roomName: string;
  /** Calendar day as "YYYY-MM-DD". */
  date: string;
  /** Wall-clock "HH:MM". */
  startTime: string;
  /** Wall-clock "HH:MM". */
  endTime: string;
  status: string;
  /** True for a currently open spontaneous block. */
  isSpontaneous?: boolean;
  /** The block does not take place ("fällt aus"). */
  cancelled: boolean;
  isPrimary: boolean;
  /** This staff member stands in for the block (Vertretung, #1840). */
  isSubstitute: boolean;
  /** This staff member was pulled from the block (Vertretungsplan, #1840). */
  isAbsent: boolean;
  absenceReason: string | null;
  cancelReason: string | null;
  /** Admin acknowledged the block running understaffed (#1840). */
  understaffedAck: boolean;
}

export function mapOwnAssignment(
  data: Omit<assignmentResponse, "date"> & { date: string },
): OwnAssignment {
  return {
    instanceId: data.instance_id,
    title: data.title,
    groupName: data.group_name ?? null,
    roomName: data.room_name ?? "",
    date: data.date.slice(0, 10),
    startTime: data.start_time.slice(0, 5),
    endTime: data.end_time.slice(0, 5),
    status: data.status,
    isSpontaneous: data.is_spontaneous,
    cancelled: data.cancelled,
    isPrimary: data.is_primary,
    isSubstitute: data.is_substitute,
    isAbsent: data.is_absent,
    absenceReason: data.absence_reason ?? null,
    cancelReason: data.cancel_reason ?? null,
    understaffedAck: data.understaffed_ack,
  };
}

const HOURS_FORMAT = new Intl.NumberFormat("de-DE", {
  maximumFractionDigits: 2,
});

/** 1215 → "20,25 h", 2400 → "40 h" */
export function formatPlannedHours(minutes: number): string {
  return `${HOURS_FORMAT.format(minutes / 60)} h`;
}

/** -300 → "−5 h", 90 → "+1,5 h", 0 → "±0 h" (U+2212 minus sign) */
export function formatDeltaHours(minutes: number): string {
  if (minutes === 0) return "±0 h";
  const sign = minutes > 0 ? "+" : "−";
  return `${sign}${HOURS_FORMAT.format(Math.abs(minutes) / 60)} h`;
}

/** "08:00–16:00" */
export function formatShiftLabel(shift: StaffShift): string {
  return `${shift.startTime}–${shift.endTime}`;
}

/** "2026-07-13" → "13.07." — the day/month sublabel of a grid column. */
export function formatColumnDate(isoDate: string): string {
  const [, m, d] = isoDate.split("-");
  return `${d}.${m}.`;
}

/**
 * Delta tone of a weekly summary label: under contract → "under" (red), over →
 * "over" (amber), exact or no target → "neutral". Structurally identical to the
 * ui kit's `CoverageTone` — the grids pass this value straight to
 * `CoverageIndicator`'s `tone` — but declared here so lib never imports from
 * components (the dependency direction must stay one-way).
 */
export type SummaryTone = "neutral" | "under" | "over";

/**
 * The minimal delta shape shared by the week-view row-header summary
 * (`StaffWeeklySummary`) and the half-year cell summary. Both satisfy it
 * structurally, so `summaryTone`/`summaryLabel` work for either.
 */
export interface SummaryDelta {
  plannedMinutes: number;
  targetMinutes: number | null;
  deltaMinutes: number | null;
}

// Under contract → red, over → amber, exact/no target → neutral (docs/05
// Abschnitt 2.3). Only the free-text label of the CoverageIndicator is tinted.
export function summaryTone(summary: SummaryDelta): SummaryTone {
  if (summary.targetMinutes === null || summary.deltaMinutes === null) {
    return "neutral";
  }
  if (summary.deltaMinutes < 0) return "under";
  if (summary.deltaMinutes > 0) return "over";
  return "neutral";
}

// "18/20,25 h" with a target, "18 h" without one (docs/05 Abschnitt 2.3).
export function summaryLabel(summary: SummaryDelta): string {
  const planned = formatPlannedHours(summary.plannedMinutes);
  if (summary.targetMinutes === null) return planned;
  const plannedValue = planned.replace(/\s*h$/, "");
  return `${plannedValue}/${formatPlannedHours(summary.targetMinutes)}`;
}

/**
 * Groups shifts for the week grid: staffId -> date ("YYYY-MM-DD") -> shifts
 * (sorted by start time, as delivered by the backend).
 */
export function groupShiftsByStaffAndDate(
  shifts: readonly StaffShift[],
): Map<string, Map<string, StaffShift[]>> {
  const byStaff = new Map<string, Map<string, StaffShift[]>>();
  for (const shift of shifts) {
    let byDate = byStaff.get(shift.staffId);
    if (!byDate) {
      byDate = new Map<string, StaffShift[]>();
      byStaff.set(shift.staffId, byDate);
    }
    const list = byDate.get(shift.date);
    if (list) {
      list.push(shift);
    } else {
      byDate.set(shift.date, [shift]);
    }
  }
  return byStaff;
}

/**
 * Eine Schicht aus einer Serie, die Ferien und Schließtage auslässt, die
 * trotzdem an so einem Tag steht (#8205). `adjusted`: von Hand geändert,
 * moto sagt sie deshalb nicht ab. Sonst ist der Tag später zum Schließtag
 * geworden, ohne dass moto die Schicht absagen konnte (Schließtag des
 * Trägers, Ferien).
 */
export interface BreakDayShift {
  shiftId: string;
  staffId: string;
  /** "YYYY-MM-DD" */
  date: string;
  /** "HH:MM" */
  startTime: string;
  /** "HH:MM" */
  endTime: string;
  kind: "closing_day" | "holiday_period";
  adjusted: boolean;
}

export function mapBreakDayShift(data: SeriesBreakDayShift): BreakDayShift {
  return {
    shiftId: data.shift_id,
    staffId: data.staff_id,
    date: data.date,
    startTime: data.start_time,
    endTime: data.end_time,
    // Ein unbekannter neuer Grund liest sich wie ein Schließtag: die Warnung
    // bleibt sichtbar.
    kind: data.break === "holiday_period" ? "holiday_period" : "closing_day",
    adjusted: data.adjusted,
  };
}

/** „Schließtag“ oder „Ferien“, wie der Grund an der Schicht. */
export const BREAK_DAY_LABEL: Readonly<Record<BreakDayShift["kind"], string>> =
  {
    closing_day: "Schließtag",
    holiday_period: "Ferien",
  };
