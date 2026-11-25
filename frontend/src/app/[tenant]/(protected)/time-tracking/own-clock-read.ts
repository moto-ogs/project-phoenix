import { ApiError } from "~/lib/api-error";
import type {
  OwnClockOverview,
  OwnTimeTotals,
} from "~/lib/contract/time-tracking.generated";
import { parseISODate } from "~/lib/date-helpers";
import type { ClockSession } from "~/lib/own-time-tracking-view";
import {
  mapOwnAbsence,
  mapOwnBlock,
  mapOwnShift,
  requireOwnDate,
} from "~/lib/own-time-tracking-view";
import { mapOwnAssignment } from "~/lib/shift-helpers";
import { timeTrackingService } from "~/lib/time-tracking-api";
import {
  mapWorkDayLaborHint,
  type WorkSessionBreak,
} from "~/lib/time-tracking-helpers";

export async function readOwnClock(today: string) {
  return mapOwnClock(await timeTrackingService.getOverview(), today);
}

export function mapOwnClock(overview: OwnClockOverview, today: string) {
  if (overview.today !== today) {
    throw new ApiError("Own clock date changed", undefined, {
      code: "general.unavailable",
    });
  }

  const block = overview.session ? mapOwnBlock(overview.session) : null;
  const session: ClockSession | null = block;
  const breaks: WorkSessionBreak[] = block?.breaks ?? [];
  const shifts = (
    overview.shifts.state === "ready" ? (overview.shifts.rows ?? []) : []
  )
    .map(mapOwnShift)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  return {
    asOf: overview.as_of,
    staffId: overview.staff_id,
    session,
    breaks,
    absence: overview.today_absence
      ? mapOwnAbsence(overview.today_absence)
      : null,
    chart: overview.chart ?? [],
    completedToday: overview.completed_today_minutes,
    laborDays: (overview.labor_days ?? []).map(mapWorkDayLaborHint),
    shiftsUnavailable:
      overview.shifts.state !== "ready" &&
      overview.shifts.state !== "not_booked",
    plannedShifts: shifts.filter((shift) => !shift.cancelled),
    cancelledShifts: shifts.filter((shift) => shift.cancelled),
    assignmentsUnavailable: overview.assignments.state !== "ready",
    assignments:
      overview.assignments.state === "ready"
        ? (overview.assignments.rows ?? []).map((row) =>
            mapOwnAssignment({
              ...row,
              date: requireOwnDate(row.date),
            }),
          )
        : undefined,
    week: overview.week,
    month: overview.month,
    accountStart: overview.account_start,
    accountBalanceMinutes: overview.account_balance_minutes,
    todayCountsInTotals: overview.today_counts_in_totals,
  };
}

function totals(totals: OwnTimeTotals, runningDelta: number) {
  return {
    ist: totals.actual_minutes + totals.credit_minutes + runningDelta,
    soll: totals.has_target ? totals.target_minutes : null,
  };
}

export function clockMetrics(
  data: Awaited<ReturnType<typeof readOwnClock>>,
  runningDelta: number,
) {
  // The server excludes days before accounting starts from these totals.
  const accountingDelta = data.todayCountsInTotals ? runningDelta : 0;
  return {
    week: totals(data.week, accountingDelta),
    month: totals(data.month, accountingDelta),
    accountStart:
      data.accountStart === null ? null : parseISODate(data.accountStart),
    accountBalanceMinutes:
      data.accountBalanceMinutes === null
        ? null
        : data.accountBalanceMinutes + accountingDelta,
    hasTargetOverride: data.week.has_override || data.month.has_override,
    hasTarget: data.month.has_target,
  };
}
