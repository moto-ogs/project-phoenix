import { ApiError } from "~/lib/api-error";
import type {
  OwnTimePeriod,
  OwnTimePeriodView,
} from "~/lib/contract/time-tracking.generated";
import {
  mapOwnAbsence,
  mapOwnBlock,
  mapOwnShift,
  requireOwnDate,
} from "~/lib/own-time-tracking-view";
import { adaptHistorySessionForMetrics } from "~/lib/staff-metrics-helpers";
import {
  mapClosingDaysResponse,
  mapHolidaysResponse,
  mapMonthSummaryResponse,
  mapWeeklySummaries,
  mapWorkDayLaborHint,
} from "~/lib/time-tracking-helpers";

export function mapOwnPeriod(
  period: OwnTimePeriod,
  view: OwnTimePeriodView,
  start: string,
) {
  if (period.start !== start || period.view !== view) {
    throw new ApiError("Own period did not match its request", undefined, {
      code: "general.unavailable",
    });
  }
  const end = requireOwnDate(period.end);
  const sessions = (period.sessions ?? []).map(mapOwnBlock);
  const absences = (period.absences ?? []).map(mapOwnAbsence);
  const dailyProjection = new Map(
    (period.days ?? []).map((day) => {
      const date = requireOwnDate(day.date);
      return [
        date,
        {
          targetMinutes: day.target_minutes,
          creditMinutes: day.credit_minutes,
          actualMinutes: day.actual_minutes,
          balanceMinutes: day.balance_minutes,
          isOverride: day.target_source === "override",
          hasTarget: day.has_target,
        },
      ] as const;
    }),
  );
  return {
    staffId: period.staff_id,
    from: start,
    to: end,
    sessions,
    rows: sessions.map(adaptHistorySessionForMetrics),
    absences,
    laborDays: (period.labor_days ?? []).map(mapWorkDayLaborHint),
    weeklySummaries: mapWeeklySummaries(period.weekly_summaries),
    dailyProjection,
    accountStart: period.account_start ?? "",
    holidays: mapHolidaysResponse(
      (period.holidays ?? []).map((day) => ({
        ...day,
        date: requireOwnDate(day.date),
      })),
    ),
    closingDays: mapClosingDaysResponse(
      (period.closing_days ?? []).map((range) => ({
        ...range,
        start_date: requireOwnDate(range.start_date),
        end_date: requireOwnDate(range.end_date),
      })),
      start,
      end,
    ),
    shifts:
      period.shifts.state === "ready"
        ? (period.shifts.rows ?? []).map(mapOwnShift)
        : undefined,
    shiftsUnavailable:
      period.shifts.state !== "ready" && period.shifts.state !== "not_booked",
    monthSummary: period.month_summary
      ? mapMonthSummaryResponse(period.month_summary)
      : null,
    plannedShiftState: period.month_summary?.planned_shift_state,
  };
}
