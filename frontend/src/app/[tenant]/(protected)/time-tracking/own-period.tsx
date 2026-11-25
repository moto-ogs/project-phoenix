"use client";

import { useEffect, useMemo, useRef } from "react";
import { StaffSessionTable } from "~/components/staff/staff-session-table";
import { Monatskarte } from "~/components/time-tracking/monatskarte";
import { DataTableSkeleton } from "~/components/ui/data-table";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { SkeletonRegion } from "~/components/ui/page-skeletons";
import { SectionCard } from "~/components/ui/section-card";
import { ApiError } from "~/lib/api-error";
import type { OwnTimePeriodView } from "~/lib/contract/time-tracking.generated";
import { berlinTodayISO, parseISODate, toISODate } from "~/lib/date-helpers";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import {
  type OwnAbsence,
  type OwnBlock,
  mapOwnAbsence,
  mapOwnBlock,
  mapOwnShift,
  requireOwnDate,
} from "~/lib/own-time-tracking-view";
import {
  adaptAbsenceForMetrics,
  adaptHistorySessionForMetrics,
} from "~/lib/staff-metrics-helpers";
import {
  revalidateOrThrow,
  useLiveRefreshInterval,
  useSWRAuth,
} from "~/lib/swr";
import { timeTrackingKeys } from "~/lib/swr/portal-keys";
import { timeTrackingService } from "~/lib/time-tracking-api";
import {
  mapClosingDaysResponse,
  mapHolidaysResponse,
  mapMonthSummaryResponse,
  mapWeeklySummaries,
  mapWorkDayLaborHint,
  OPEN_MONTH_REFRESH_MS,
  type WorkDayLaborHint,
} from "~/lib/time-tracking-helpers";

export interface OwnPeriodEdit {
  readonly date: Date;
  readonly session: OwnBlock | null;
  readonly absence: OwnAbsence | null;
  readonly laborDay?: WorkDayLaborHint;
  readonly reloadDay: () => Promise<unknown>;
}

const unavailableShifts = new ApiError(
  "Own period shifts unavailable",
  undefined,
  {
    code: "general.unavailable",
  },
);

const fetchOwnEdits = (_staffId: string, sessionId: string) =>
  timeTrackingService.getSessionEdits(sessionId);

async function getPeriod(view: OwnTimePeriodView, start: string) {
  const period = await timeTrackingService.getPeriod(view, start);
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
    from: parseISODate(start),
    to: parseISODate(end),
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

export function OwnPeriod({
  view,
  start,
  today,
  isCurrent,
  isSessionOpen,
  staffId,
  setTargetHref,
  onEdit,
}: {
  readonly view: OwnTimePeriodView;
  readonly start: string;
  readonly today: string;
  readonly isCurrent: boolean;
  readonly isSessionOpen: boolean;
  readonly staffId?: string;
  readonly setTargetHref?: string;
  readonly onEdit: (edit: OwnPeriodEdit) => void;
}) {
  const interval = useLiveRefreshInterval(OPEN_MONTH_REFRESH_MS);
  const read = useSWRAuth(
    timeTrackingKeys.period(view, start),
    () => getPeriod(view, start),
    {
      keepPreviousData: false,
      revalidateOnFocus: false,
      refreshInterval: isCurrent && isSessionOpen ? interval : 0,
    },
  );
  const { data, error, mutate, isValidating } = read;
  const previous = useRef({ today, start, view });
  useEffect(() => {
    const last = previous.current;
    previous.current = { today, start, view };
    // The same period can gain a new "today" without changing its key.
    if (
      last.today !== today &&
      last.start === start &&
      last.view === view &&
      (isCurrent || (data && toISODate(data.to) === last.today))
    ) {
      void mutate();
    }
  }, [today, start, view, isCurrent, data, mutate]);
  const loadError = useSwrLoadError(
    error ?? (data?.shiftsUnavailable ? unavailableShifts : undefined),
    error ? "die Liste deiner Arbeitszeiten" : "die Liste deiner Schichten",
    mutate,
  );
  const absences = useMemo(
    () =>
      staffId
        ? data?.absences.map((absence) =>
            adaptAbsenceForMetrics({ ...absence, staffId }),
          )
        : undefined,
    [staffId, data],
  );
  const reload = () => revalidateOrThrow(read);

  return (
    <SectionCard title="Zeiterfassung">
      <LoadErrorAlert error={loadError} />
      {!data && !error && (
        <SkeletonRegion label="Einträge werden geladen…">
          <DataTableSkeleton rows={7} columns={5} />
        </SkeletonRegion>
      )}
      {data && (
        <>
          {view === "month" && (
            <div className="mb-4">
              <Monatskarte
                summary={data.monthSummary}
                isLoading={false}
                plannedShiftState={data.plannedShiftState}
                isCurrentMonth={isCurrent}
                isPreAccountMonth={
                  data.accountStart !== "" &&
                  start.slice(0, 7) < data.accountStart.slice(0, 7)
                }
                accountStartsInFuture={data.accountStart > today}
                accountStartDate={data.accountStart}
                setTargetHref={setTargetHref}
              />
            </div>
          )}
          <StaffSessionTable
            staffId={staffId ?? ""}
            from={data.from}
            to={data.to}
            sessions={data.rows}
            reloadSessions={reload}
            absences={absences}
            absencesUnresolved={!staffId || error !== undefined}
            schedule={null}
            dailyProjection={data.dailyProjection}
            dailyProjectionPending
            holidays={data.holidays}
            closingDays={data.closingDays}
            accountStartDate={data.accountStart}
            accountStartDatePending={false}
            accountStartDateError={undefined}
            today={parseISODate(today)}
            isAdminView
            editsUnresolved={!staffId || error !== undefined || isValidating}
            onEditDay={(date, row, absenceRow) => {
              const session =
                data.sessions.find((block) => block.id === row?.id) ?? null;
              const absence =
                data.absences.find((entry) => entry.id === absenceRow?.id) ??
                null;
              const workday = session
                ? berlinTodayISO(new Date(session.checkInTime))
                : toISODate(date);
              onEdit({
                date,
                session,
                absence,
                laborDay: data.laborDays.find((day) => day.date === workday),
                reloadDay: reload,
              });
            }}
            plannedShifts={data.shifts}
            fetchEdits={fetchOwnEdits}
            laborDays={data.laborDays}
            weeklySummaries={data.weeklySummaries}
          />
        </>
      )}
    </SectionCard>
  );
}
