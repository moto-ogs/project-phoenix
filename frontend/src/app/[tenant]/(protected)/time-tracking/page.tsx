"use client";

import { Suspense, useState } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { CalendarRange } from "lucide-react";
import {
  ViewToggle,
  formatSignedDuration,
  type ViewMode,
} from "~/components/staff/staff-time-views";
import { workTimeModelPath } from "~/components/staff/missing-target-notice";
import { StaffExportButton } from "~/components/staff/staff-export-button";
import { LeaveRequestsCard } from "~/components/time-tracking/leave-requests-card";
import { useNoOwnStaffProfileEmpty } from "~/components/time-tracking/no-own-staff-profile";
import { ButtonLink } from "~/components/ui/button";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import { PlanningContextBar } from "~/components/ui/planning/planning-context-bar";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { useToast } from "~/contexts/ToastContext";
import { dispatchAbsencesRefresh } from "~/lib/absence-helpers";
import { hasEffectiveAdminScope, hasPermission } from "~/lib/auth-utils";
import { timeTrackingConcept } from "~/lib/concepts/timeTracking";
import type { UpdateAbsenceRequest } from "~/lib/contract/time-tracking.generated";
import { parseISODate, toISODate } from "~/lib/date-helpers";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { useOwnTimeRefresh } from "~/lib/hooks/use-own-time-refresh";
import {
  endOfWeek,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from "~/lib/staff-metrics-helpers";
import { useSWRCacheKey } from "~/lib/swr";
import { useModuleBooked } from "~/lib/tenant-context";
import { useTenantAwarePath } from "~/lib/tenant-path";
import {
  timeTrackingService,
  type CreateAbsenceRequest,
  type UpdateSessionRequest,
} from "~/lib/time-tracking-api";
import { formatDuration } from "~/lib/time-tracking-helpers";
import { formatWeekLabel } from "~/lib/timetable-helpers";
import {
  CreateAbsenceModal,
  EditSessionModal,
} from "./absence-and-session-dialogs";
import { ClockDialogs, OwnClockCards, useOwnClock } from "./own-clock";
import { OwnPeriod, type OwnPeriodEdit } from "./own-period";

const TITLE = "Zeiterfassung";
const INFO =
  "Hier erfasst du deine Arbeitszeit und deine Pausen. Wähle zuerst unter „Stempeluhr“ deinen Arbeitsort und dann „Einstempeln“. Oben siehst du deinen Stand, darunter deine erfassten Zeiten.";
const EMPTY_ICON = <MotoConceptIcon concept={timeTrackingConcept} size={48} />;

function startFor(view: ViewMode, date: Date): Date {
  return view === "month" ? startOfMonth(date) : startOfWeek(date);
}

function TimeTrackingContent() {
  const { data: session } = useSession();
  const today = useBerlinToday();
  const currentDate = parseISODate(today);
  const toast = useToast();
  const [view, setView] = useState<ViewMode>("week");
  // null follows the current Berlin week/month, including across midnight.
  const [selection, setSelection] = useState<string | null>(null);
  const currentStart = startFor(view, currentDate);
  const anchor =
    selection === null ? currentStart : startFor(view, parseISODate(selection));
  const start = toISODate(anchor);
  const isCurrent = start === toISODate(currentStart);
  const rangeLabel =
    view === "week"
      ? formatWeekLabel(anchor, endOfWeek(anchor))
      : anchor.toLocaleDateString("de-DE", { month: "long", year: "numeric" });

  function move(direction: -1 | 1) {
    const next = new Date(anchor);
    if (view === "month") next.setMonth(next.getMonth() + direction);
    else next.setDate(next.getDate() + direction * 7);
    const key = toISODate(next);
    setSelection(key === toISODate(currentStart) ? null : key);
  }

  const [edit, setEdit] = useState<OwnPeriodEdit | null>(null);
  const [absenceOpen, setAbsenceOpen] = useState(false);
  const clock = useOwnClock(today);
  const refresh = useOwnTimeRefresh();
  const noOwnStaff = useNoOwnStaffProfileEmpty(
    EMPTY_ICON,
    hasPermission(session, "time_tracking:own"),
    [clock.error],
  );
  const staffId = clock.data?.staffId;
  const canManage = hasPermission(session, "time_tracking:manage");
  const hasShiftPlan = useModuleBooked("dienstplan");
  const tenantPath = useTenantAwarePath();
  const targetHref =
    staffId && hasEffectiveAdminScope(session)
      ? tenantPath(workTimeModelPath(staffId))
      : undefined;

  async function saveSession(id: string, update: UpdateSessionRequest) {
    await timeTrackingService.updateSession(id, update);
    await refresh("time");
    toast.success("Die Arbeitszeit ist gespeichert.");
  }
  async function refreshAbsence() {
    dispatchAbsencesRefresh();
    await refresh("leave");
  }
  async function createAbsence(request: CreateAbsenceRequest) {
    const created = await timeTrackingService.createAbsence(request);
    setAbsenceOpen(false);
    await refreshAbsence();
    toast.success(
      created.status === "requested"
        ? "Der Antrag ist bei der Leitung."
        : "Die Abwesenheit ist eingetragen.",
    );
  }
  async function deleteAbsence(id: string) {
    await timeTrackingService.deleteAbsence(id);
    await refreshAbsence();
    toast.success("Die Abwesenheit ist gelöscht.");
  }
  async function updateAbsence(id: string, request: UpdateAbsenceRequest) {
    await timeTrackingService.updateAbsence(id, request);
    await refreshAbsence();
    toast.success("Die Abwesenheit ist gespeichert.");
  }

  if (noOwnStaff)
    return <TenantPage title={TITLE} info={INFO} empty={noOwnStaff} />;

  const metrics = clock.metrics;
  return (
    <TenantPage
      title={TITLE}
      info={INFO}
      statsLoading={!metrics && !clock.error}
      stats={
        metrics && (
          <TenantPageStats
            items={[
              { value: formatDuration(metrics.week.ist), label: "Ist" },
              {
                value:
                  metrics.week.soll === null
                    ? "Unbekannt"
                    : formatDuration(metrics.week.soll),
                label: "Soll",
              },
              {
                value:
                  metrics.accountBalanceMinutes === null
                    ? "–"
                    : formatSignedDuration(metrics.accountBalanceMinutes),
                label: "Saldo",
              },
            ]}
          />
        )
      }
      actions={
        staffId && (
          <>
            {hasShiftPlan && (
              <ButtonLink
                href={tenantPath("/mein-dienstplan")}
                variant="outline"
                size="md"
                tooltip="Öffnet deine geplanten Schichten der Woche."
              >
                <CalendarRange
                  className="mr-1.5 h-4 w-4 shrink-0"
                  aria-hidden
                />
                <span className="whitespace-nowrap">Mein Dienstplan</span>
              </ButtonLink>
            )}
            <StaffExportButton
              staffId={staffId}
              yearStart={startOfYear(currentDate)}
            />
          </>
        )
      }
      searchSlot={
        <PlanningContextBar
          withoutContextRow
          dateLabel={rangeLabel}
          onPrevious={() => move(-1)}
          onNext={() => move(1)}
          previousLabel={
            view === "month" ? "Vorheriger Monat" : "Vorherige Woche"
          }
          nextLabel={view === "month" ? "Nächster Monat" : "Nächste Woche"}
          onToday={isCurrent ? undefined : () => setSelection(null)}
          todayLabel={view === "month" ? "Dieser Monat" : "Diese Woche"}
          viewSwitcher={<ViewToggle value={view} onChange={setView} />}
        />
      }
      overlays={
        <>
          {edit && (
            <EditSessionModal
              isOpen
              onClose={() => setEdit(null)}
              session={edit.session}
              date={edit.date}
              onSave={saveSession}
              onReload={edit.reloadDay}
              absence={edit.absence}
              onUpdateAbsence={updateAbsence}
              onDeleteAbsence={deleteAbsence}
              canManage={canManage}
              timesLocked={clock.data?.terminalOnlyStamping ?? false}
              ownStaffId={edit.staffId}
              laborDay={edit.laborDay}
            />
          )}
          {absenceOpen && (
            <CreateAbsenceModal
              isOpen
              onClose={() => setAbsenceOpen(false)}
              onSave={createAbsence}
              canManageAbsenceTypes={canManage}
            />
          )}
          <ClockDialogs clock={clock} />
        </>
      }
    >
      <OwnClockCards
        clock={clock}
        onAddAbsence={() => setAbsenceOpen(true)}
        setTargetHref={targetHref}
      />
      <LeaveRequestsCard />
      <OwnPeriod
        view={view}
        start={start}
        today={today}
        isCurrent={isCurrent}
        isSessionOpen={clock.currentSession?.checkOutTime === null}
        setTargetHref={targetHref}
        onEdit={setEdit}
      />
    </TenantPage>
  );
}

function TimeTrackingPageSkeleton() {
  return (
    <TenantPage
      title={TITLE}
      info={INFO}
      statsLoading
      loading
      loadingLabel="Zeiterfassung wird geladen…"
    />
  );
}

function TimeTrackingGate() {
  const { data: session, status } = useSession({
    required: true,
    onUnauthenticated() {
      redirect("/");
    },
  });
  const booked = useModuleBooked("zeiterfassung");
  const scope = useSWRCacheKey()("");
  const noOwnStaff = useNoOwnStaffProfileEmpty(
    EMPTY_ICON,
    hasPermission(session, "time_tracking:own"),
  );
  if (!booked) return <TenantPage title={TITLE} info={INFO} />;
  if (noOwnStaff)
    return <TenantPage title={TITLE} info={INFO} empty={noOwnStaff} />;
  if (status === "loading" || scope === null)
    return <TimeTrackingPageSkeleton />;
  return <TimeTrackingContent key={scope} />;
}

export default function TimeTrackingPage() {
  return (
    <Suspense fallback={<TimeTrackingPageSkeleton />}>
      <TimeTrackingGate />
    </Suspense>
  );
}
