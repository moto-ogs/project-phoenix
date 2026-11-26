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
import type { OwnAbsence, OwnBlock } from "~/lib/own-time-tracking-view";
import { adaptAbsenceForMetrics } from "~/lib/staff-metrics-helpers";
import {
  revalidateOrThrow,
  useLiveRefreshInterval,
  useSWRAuth,
} from "~/lib/swr";
import { timeTrackingKeys } from "~/lib/swr/portal-keys";
import { timeTrackingService } from "~/lib/time-tracking-api";
import {
  OPEN_MONTH_REFRESH_MS,
  type WorkDayLaborHint,
} from "~/lib/time-tracking-helpers";

import { mapOwnPeriod } from "./own-period-read";

export interface OwnPeriodEdit {
  readonly staffId: string;
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
  return mapOwnPeriod(
    await timeTrackingService.getPeriod(view, start),
    view,
    start,
  );
}

export function OwnPeriod({
  view,
  start,
  today,
  isCurrent,
  isSessionOpen,
  setTargetHref,
  onEdit,
}: {
  readonly view: OwnTimePeriodView;
  readonly start: string;
  readonly today: string;
  readonly isCurrent: boolean;
  readonly isSessionOpen: boolean;
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
  const { data, error, mutate } = read;
  const from = useMemo(
    () => parseISODate(data?.from ?? start),
    [data?.from, start],
  );
  const to = useMemo(() => parseISODate(data?.to ?? start), [data?.to, start]);
  const previous = useRef({ today, start, view });
  useEffect(() => {
    const last = previous.current;
    previous.current = { today, start, view };
    // The same period can gain a new "today" without changing its key.
    if (
      last.today !== today &&
      last.start === start &&
      last.view === view &&
      (isCurrent || (data && data.to === last.today))
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
      data?.absences.map((absence) =>
        adaptAbsenceForMetrics({ ...absence, staffId: data.staffId }),
      ),
    [data],
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
            staffId={data.staffId}
            from={from}
            to={to}
            sessions={data.rows}
            reloadSessions={reload}
            absences={absences}
            absencesUnresolved={error !== undefined}
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
            editsUnresolved={error !== undefined}
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
                staffId: data.staffId,
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
