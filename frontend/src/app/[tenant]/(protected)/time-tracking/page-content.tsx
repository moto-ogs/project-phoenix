"use client";

import { Suspense, useState } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { CalendarRange } from "lucide-react";
import {
  TargetOriginChip,
  ViewToggle,
  formatSignedDuration,
  type ViewMode,
} from "~/components/staff/staff-time-views";
import { workTimeModelPath } from "~/components/staff/missing-target-notice";
import { StaffExportButton } from "~/components/staff/staff-export-button";
import { LeaveRequestsCard } from "~/components/time-tracking/leave-requests-card";
import { useNoOwnStaffProfileEmpty } from "~/components/time-tracking/no-own-staff-profile";
import { ButtonLink } from "~/components/ui/button";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import {
  SegmentedControl,
  type SegmentedControlItem,
} from "~/components/ui/segmented-control";
import {
  AppAccountCard,
  AppRangeBar,
  AppTimeTrackingLayout,
} from "~/components/time-tracking/time-tracking-app";
import { useDeviceContext } from "~/lib/device-context";
import { useTenantRouter } from "~/lib/tenant-router";
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
import {
  ClockDialogs,
  OwnAppClockCard,
  OwnAppTodayCard,
  OwnClockCards,
  useOwnClock,
} from "./own-clock";
import { OwnPeriod, type OwnPeriodEdit } from "./own-period";

const TITLE = "Zeiterfassung";
const INFO =
  "Hier erfasst du deine Arbeitszeit und deine Pausen. Wähle zuerst unter „Stempeluhr“ deinen Arbeitsort und dann „Einstempeln“. Oben siehst du deinen Stand, darunter deine erfassten Zeiten.";
// Dieselbe Hilfe in der App (#8070): die Stempeluhr zeigt dort nur den
// Zustand, gestempelt wird unten über die Leiste.
const APP_INFO =
  "Hier erfasst du deine Arbeitszeit und deine Pausen. Tippe unten auf „Einstempeln“ und wähle, wo du arbeitest. Oben stehen deine Woche und dein Saldo (Stundenkonto), darunter deine Woche Tag für Tag. Tippe auf einen Tag, um ihn anzusehen oder zu korrigieren.";
const EMPTY_ICON = <MotoConceptIcon concept={timeTrackingConcept} size={48} />;

/** App (#8070): Woche/Monat in der Leiste der Tagesliste. */
const APP_VIEW_MODE_ITEMS: readonly SegmentedControlItem<ViewMode>[] = [
  { value: "week", label: "Woche" },
  { value: "month", label: "Monat" },
];

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
  const tenantRouter = useTenantRouter();
  // App-Oberfläche (#8070): erst nach der Hydration bekannt; bis dahin und auf
  // dem Desktop bleibt es beim heutigen Aufbau.
  const device = useDeviceContext();
  const app = device.resolved && device.isApp;
  // Telefon (Runde 17): Die Stempeluhr steht als Zeile in der Kopfkarte;
  // sie rendert dorthin, sobald der Platz da ist.
  const [clockHeadSlot, setClockHeadSlot] = useState<HTMLDivElement | null>(
    null,
  );
  const [clockCompactSlot, setClockCompactSlot] =
    useState<HTMLSpanElement | null>(null);
  const clockInHead = app && device.layout === "phone";
  // App: Der Export steht im „…“-Blatt der Kopfkarte (Runde 11).
  const [exportOpen, setExportOpen] = useState(false);

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
  // Seit wann der Saldo im Kopf zählt; die Liste nennt den Saldo der Woche.
  const accountStart = metrics?.accountStart ?? null;
  const accountSinceLabel =
    accountStart === null
      ? "Saldo"
      : accountStart.getMonth() === 0 && accountStart.getDate() === 1
        ? `Saldo ${accountStart.getFullYear()}`
        : `Saldo seit ${accountStart.getDate()}.${accountStart.getMonth() + 1}.`;
  const balanceText =
    metrics?.accountBalanceMinutes == null
      ? "–"
      : formatSignedDuration(metrics.accountBalanceMinutes);
  // App (#8070): Woche/Monat steht oben in der Karte der Tage, nicht in der
  // Kopfkarte: Der Kopf bleibt am SE unter 20 % der Höhe (Runde 11), und
  // die Wahl steht bei dem, was sie umschaltet. Runde 15: in derselben
  // Zeile wie die Pfeile; „Mein Dienstplan“ steht wie am Desktop bei den
  // Kopfaktionen (im „…“-Menü), damit am SE die Woche ins erste Bild passt.
  const appRangeLabel =
    view === "month"
      ? anchor.toLocaleDateString("de-DE", {
          timeZone: "Europe/Berlin",
          month: "short",
          year: "numeric",
        })
      : (rangeLabel.split(" · ")[0] ?? rangeLabel);
  const editModal = edit && (
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
      app={app}
      facts={edit.facts}
    />
  );
  const absenceModal = absenceOpen && (
    <CreateAbsenceModal
      isOpen
      onClose={() => setAbsenceOpen(false)}
      onSave={createAbsence}
      canManageAbsenceTypes={canManage}
    />
  );

  if (app) {
    return (
      <TenantPage
        title={TITLE}
        info={APP_INFO}
        statsLoading={!metrics && !clock.error && !clockInHead}
        appCompactStats={
          clockInHead ? (
            <span ref={setClockCompactSlot} className="inline-flex" />
          ) : undefined
        }
        stats={
          clockInHead ? (
            // Runde 21: Zustand und Saldo in einer Zeile, solange beide
            // passen; die laufende Zeit bricht den Saldo in die nächste.
            <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
              <div ref={setClockHeadSlot} className="min-w-0" />
              {metrics ? (
                // Runde 19: Am Telefon eine Saldo-Zahl im Kopf. Die Stunden
                // der Woche stehen über den Tagen der Woche und im
                // Stundenkonto, so konkurrieren keine drei Zahlen im ersten
                // Bild.
                <TenantPageStats
                  items={[{ value: balanceText, label: accountSinceLabel }]}
                />
              ) : null}
            </div>
          ) : (
            metrics && (
              // App (#8070): zwei Zahlen mit eindeutigem Namen. Die Woche
              // steht als „Ist / Soll“, das Stundenkonto ist der Stand über
              // alle Wochen. Der Wochensaldo steht an der Woche in der Liste.
              <TenantPageStats
                items={[
                  {
                    value: `${formatDuration(metrics.week.ist)} / ${
                      metrics.week.soll === null
                        ? "Unbekannt"
                        : formatDuration(metrics.week.soll)
                    }`,
                    label: "Woche",
                  },
                  { value: balanceText, label: accountSinceLabel },
                ]}
              />
            )
          )
        }
        overflowMenu={
          staffId
            ? [
                {
                  label: "Zeitnachweis exportieren",
                  description:
                    "Öffnet die Auswahl von Zeitraum und Format für den Zeitnachweis.",
                  onClick: () => setExportOpen(true),
                },
                ...(hasShiftPlan
                  ? [
                      {
                        label: "Mein Dienstplan",
                        description:
                          "Öffnet deine geplanten Schichten der Woche.",
                        // Ein Knopf wie der Eintrag darüber (gleicher
                        // Einzug im Blatt), kein Link-Eintrag.
                        onClick: () => tenantRouter.push("/mein-dienstplan"),
                      },
                    ]
                  : []),
              ]
            : undefined
        }
        overlays={
          <>
            {staffId ? (
              <StaffExportButton
                staffId={staffId}
                yearStart={startOfYear(currentDate)}
                open={exportOpen}
                onOpenChange={setExportOpen}
              />
            ) : null}
            {editModal}
            {absenceModal}
            <ClockDialogs clock={clock} />
          </>
        }
      >
        <AppTimeTrackingLayout
          errors={
            clock.loadError || (clock.data && clock.shiftError) ? (
              <div className="space-y-3">
                <LoadErrorAlert error={clock.loadError} />
                {clock.data ? (
                  <LoadErrorAlert error={clock.shiftError} />
                ) : null}
              </div>
            ) : null
          }
          clock={
            <OwnAppClockCard
              clock={clock}
              onAddAbsence={() => setAbsenceOpen(true)}
              setTargetHref={targetHref}
              headSlot={clockInHead ? clockHeadSlot : undefined}
              compactSlot={clockInHead ? clockCompactSlot : undefined}
            />
          }
          days={
            <OwnPeriod
              app
              dienstplanHref={
                hasShiftPlan ? tenantPath("/mein-dienstplan") : undefined
              }
              view={view}
              start={start}
              today={today}
              isCurrent={isCurrent}
              isSessionOpen={clock.currentSession?.checkOutTime === null}
              setTargetHref={targetHref}
              onEdit={setEdit}
              rangeBar={
                <AppRangeBar
                  leading={
                    <SegmentedControl
                      ariaLabel="Zeitraum-Ansicht"
                      items={APP_VIEW_MODE_ITEMS}
                      value={view}
                      onChange={setView}
                    />
                  }
                  label={appRangeLabel}
                  onPrevious={() => move(-1)}
                  onNext={() => move(1)}
                  previousLabel={
                    view === "month" ? "Vorheriger Monat" : "Vorherige Woche"
                  }
                  nextLabel={
                    view === "month" ? "Nächster Monat" : "Nächste Woche"
                  }
                  onToday={isCurrent ? undefined : () => setSelection(null)}
                  todayLabel={view === "month" ? "Dieser Monat" : "Diese Woche"}
                />
              }
            />
          }
          account={
            metrics ? (
              <AppAccountCard
                weekIst={metrics.week.ist}
                weekSoll={metrics.week.soll}
                monthIst={metrics.month.ist}
                monthSoll={metrics.month.soll}
                accountBalanceMinutes={metrics.accountBalanceMinutes}
                accountStart={metrics.accountStart}
                origin={
                  metrics.hasTarget === false ? (
                    <TargetOriginChip
                      hasTarget={false}
                      setTargetHref={targetHref}
                    />
                  ) : metrics.hasTargetOverride ? (
                    // Der Text des Herkunfts-Chips am Desktop; am Telefon
                    // gibt es keinen Hover, also steht er da.
                    "An manchen Tagen dieser Woche gilt eine Sonderarbeitszeit statt des Arbeitszeitmodells."
                  ) : (
                    "Das Soll kommt aus deinem Arbeitszeitmodell."
                  )
                }
              />
            ) : undefined
          }
          today={<OwnAppTodayCard clock={clock} />}
          leave={<LeaveRequestsCard app />}
          // Die Kontingente zeigt die Urlaubskarte gleich unter sich; sie
          // liest sie aus derselben Urlaubsübersicht.
          allowances={null}
        />
      </TenantPage>
    );
  }

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
          {editModal}
          {absenceModal}
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

export function TimeTrackingPageSkeleton() {
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

export default function TimeTrackingContentPage() {
  return (
    <Suspense fallback={<TimeTrackingPageSkeleton />}>
      <TimeTrackingGate />
    </Suspense>
  );
}
