"use client";

// Tagesübersicht der Klassenansicht ("moto schule", #1772/#2294).
//
// Die Startseite beantwortet genau zwei Fragen: welchen Tag sehe ich, und
// welche meiner Klassen muss ich heute überhaupt aufmachen. Die Kinderlisten
// liegen eine Ebene tiefer, eine Klasse pro Seite — vorher schaltete ein
// Klick auf eine Klassenkarte etwas um, das mehrere Bildschirmhöhen weiter
// unten stand und deshalb unsichtbar blieb.
//
// Design follows the Anmeldungen/Planung surface language: one calm content
// surface inside `TenantPage`, gray-50 stat blocks, no colored dashboards.

import type * as schoolClassDayContract from "~/lib/contract/school-class-day.generated";
import { SectionLabel } from "~/components/ui/section-label";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Suspense, useCallback, useLayoutEffect, useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Button, ButtonLink } from "~/components/ui/button";
import { DatePicker } from "~/components/ui/date-picker";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { useRefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import { EmptyState } from "~/components/ui/empty-state";
import NavigationLink from "~/components/ui/navigation-link";
import { ConfirmationModal } from "~/components/ui/modal";
import { OverflowMenu } from "~/components/ui/page-header/OverflowMenu";
import type { OverflowMenuEntry } from "~/components/ui/page-header/types";
import { SectionCard } from "~/components/ui/section-card";
import { Skeleton } from "~/components/ui/skeleton";
import { TileCard } from "~/components/ui/tile-card";
import { TenantPage } from "~/components/ui/tenant-page";
import { StatCard } from "~/components/ui/stat-card";
import { getGreetingName, hasPermission } from "~/lib/auth-utils";
import { MOTO_COLOR_PALETTE } from "~/lib/kit-palette";
import { useTimeBasedGreeting } from "~/lib/greeting";
import { formatDate, parseISODate, toISODate } from "~/lib/date-helpers";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { schoolClassLabel } from "~/lib/school-class-label";
import type {
  AbsenceReportStatus,
  ClassDayClasses,
} from "~/lib/school-class-day-api";
import { schoolPath } from "~/lib/school-url";
import { useSWRAuth } from "~/lib/swr";
import { schoolPortalKeys } from "~/lib/swr/portal-keys";
import { classDayDateParam, isWeekendISO } from "./routes";
import {
  schoolDayChildrenByClass,
  schoolDayClassPath,
  schoolDayListParam,
  schoolDayListPath,
  visibleSchoolDayLists,
} from "./school-day";
import type { SchoolDayListKey } from "./school-day";
import { statusLabel } from "./status-labels";
import { useClassDayRefresh } from "./use-class-day-refresh";
import { useSchoolReportRefusal } from "./use-school-report-refusal";
import { useSchoolAbsenceReports } from "./use-school-absence-reports";
import { InsetPanel } from "~/components/ui/inset-panel";

// A focus refresh also discovers newly assigned or withdrawn classes.
const REPORT_FOCUS_THROTTLE_MS = 60 * 1000;

type ClassLine = Pick<
  schoolClassDayContract.AssignedClassesReport,
  "school_day" | "enrollment_known"
> &
  Pick<schoolClassDayContract.ClassSummary, "totals" | "changes">;

function schoolDayLines(
  report: schoolClassDayContract.SchoolDayReport,
): Record<string, ClassLine> {
  const lines: Record<string, ClassLine> = {};
  for (const klass of report.classes ?? []) {
    lines[klass.school_class] = {
      school_day: report.school_day,
      enrollment_known: report.enrollment_known,
      totals: klass.totals,
      changes: klass.totals.changes,
    };
  }
  return lines;
}

/** Zusammenfassung einer Klasse für den Tag, in einer Zeile. */
function classSummary(report: ClassLine, weekend: boolean): string {
  if (weekend || !report.school_day) return "Kein Schultag";
  const totals = report.totals;
  if (!report.enrollment_known) {
    return `${totals.students} Kinder im Klassenverband`;
  }
  const parts = [
    `${totals.students} Kinder`,
    `${totals.staying} bleiben`,
    `${totals.leaving} gehen heim`,
  ];
  if (totals.absent > 0) parts.push(`${totals.absent} abgemeldet`);
  if (totals.list_entries > 0) {
    parts.push(`${totals.list_entries} keine Betreuung`);
  }
  return parts.join(" · ");
}

function changesLabel(count: number): string {
  return count === 1
    ? "1 Kind anders als sonst"
    : `${count} Kinder anders als sonst`;
}

// Eine Klasse als Zeile: Name, die Zahlen des Tages und — nur wenn es etwas
// gibt — die Anzahl der Abweichungen. Das ist die eine Aussage, die man
// nicht durch Lesen einer Liste bekommt: welche Klasse muss ich aufmachen.
// Als Link, nicht als Knopf mit unsichtbarer Wirkung: hier passiert wirklich
// ein Seitenwechsel.
function ClassLink({
  klass,
  report,
  weekend,
  dateISO,
  openList,
}: Readonly<{
  klass: string;
  report: ClassLine | null;
  weekend: boolean;
  dateISO: string;
  openList: SchoolDayListKey | null;
}>) {
  const changes = report?.school_day ? report.changes : 0;
  const summary = report ? classSummary(report, weekend) : "Wird geladen …";
  return (
    <TileCard
      href={schoolPath(schoolDayClassPath(klass, dateISO, openList))}
      className="flex min-h-24 items-center justify-between gap-3"
    >
      {/* flex-1 + min-w-0: ohne beides schrumpft das Textfeld nicht und die
          Karte läuft auf schmalen Bildschirmen über den Rand hinaus. Die
          Zusammenfassung bricht um, statt zu kürzen — eine abgeschnittene
          Zahl ("3 abgemel…") beantwortet keine Frage. */}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-gray-900">
          {schoolClassLabel(klass)}
        </span>
        <span className="mt-1 block text-xs text-gray-500">{summary}</span>
        {changes > 0 && (
          <span className="mt-1.5 block text-xs font-medium text-gray-700">
            {changesLabel(changes)}
          </span>
        )}
      </span>
      <ChevronRight
        className="h-5 w-5 shrink-0 text-gray-500"
        aria-hidden="true"
      />
    </TileCard>
  );
}

/**
 * Was eine Liste über ein Kind nicht schon selbst sagt: in „Kinder“ und
 * „Fehlen“ der Tagesstatus, in „Kinder“ das Kind ohne Betreuung.
 */
function childNote(
  child: schoolClassDayContract.SchoolDayChild,
  list: SchoolDayListKey,
): string | null {
  // Eine Meldung, die die Schulverwaltung nachgetragen hat (#4791), sagt
  // das in jeder Liste: nur sie nimmt die Meldung zurück.
  const bySchool = child.status_by_school ? "nachgetragen" : null;
  if (list !== "kinder" && list !== "fehlen") return bySchool;
  if (child.status) {
    return [statusLabel(child.status), bySchool].filter(Boolean).join(", ");
  }
  if (child.unreported) return "ohne Meldung";
  if (list === "kinder" && (child.list_entry || child.without_care_place))
    return "keine Betreuung";
  return null;
}

/** Die Aktion, die ein Kind der Liste für die Schulverwaltung trägt (#4791). */
function absenceReportMenu(
  child: schoolClassDayContract.SchoolDayChild,
  canReport: boolean,
  onEnter: (status: AbsenceReportStatus) => void,
  onWithdraw: () => void,
): readonly OverflowMenuEntry[] {
  if (!canReport || !child.student_id || child.list_entry) return [];
  if (child.unreported) {
    return [
      { kind: "header", label: "Meldung eintragen" },
      {
        label: statusLabel("sick"),
        description: "Trägt das Kind sofort als krank ein, die OGS sieht es.",
        onClick: () => onEnter("sick"),
      },
      {
        label: statusLabel("excused"),
        description:
          "Trägt das Kind sofort als entschuldigt ein, die OGS sieht es.",
        onClick: () => onEnter("excused"),
      },
    ];
  }
  if (child.status_by_school) {
    return [
      {
        label: "Meldung zurücknehmen",
        description:
          "Nimmt die Meldung der Schule zurück, moto fragt vorher nach.",
        onClick: onWithdraw,
      },
    ];
  }
  return [];
}

export interface ClassDayOverviewProps {
  /** Fläche direkt unter der Kopfkarte, über den Klassen. */
  readonly notices?: ReactNode;
  /** Klassenliste und Wochenendplan der angemeldeten Lehrkraft. */
  readonly fetchClasses: () => Promise<ClassDayClasses>;
  readonly fetchAssignedClasses: (
    date: string,
  ) => Promise<schoolClassDayContract.AssignedClassesReport>;
  /**
   * Tagesübersicht der ganzen Schule (#4802). Darf die Person sie sehen,
   * lädt die Startseite sie einmal statt einen Report je Klasse.
   */
  readonly fetchSchoolDay?: (
    date: string,
  ) => Promise<schoolClassDayContract.SchoolDayReport>;
  /** Meldung nachtragen (#4791), nur für die Schulverwaltung. */
  readonly reportAbsence?: (
    schoolClass: string,
    date: string,
    studentId: string,
    status: AbsenceReportStatus,
  ) => Promise<void>;
  /** Nachgetragene Meldung zurücknehmen (#4791). */
  readonly withdrawAbsenceReport?: (
    schoolClass: string,
    date: string,
    studentId: string,
  ) => Promise<void>;
}

function ClassDayOverviewInfo() {
  const dateISO = classDayDateParam(useSearchParams().get("tag"));

  return (
    <p>
      Deine Übergabe nach Unterricht am {formatDate(dateISO)}. Öffne eine
      Klasse, um zu sehen, wer in Randstunde oder Ganztag bleibt und wer nach
      Hause geht.
    </p>
  );
}

function ClassDayOverviewActions() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dateISO = classDayDateParam(searchParams.get("tag"));
  const openList = schoolDayListParam(searchParams.get("liste"));
  const selectedDate = parseISODate(dateISO);

  const goToDate = (next: string) => {
    router.replace(schoolPath(schoolDayListPath(next, openList)), {
      scroll: false,
    });
  };
  const shiftDay = (delta: number) => {
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + delta);
    goToDate(toISODate(next));
  };

  return (
    <div className="flex w-full items-center gap-1 lg:w-auto">
      <Button
        type="button"
        variant="surface"
        size="icon"
        aria-label="Vorheriger Tag"
        tooltip="Zeigt die Übersicht für den Tag davor."
        onClick={() => shiftDay(-1)}
        className="shrink-0"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </Button>
      <DatePicker
        value={selectedDate}
        onChange={(date) => {
          if (date) goToDate(toISODate(date));
        }}
        calendarLayout="popover"
        hideClearButton
        className="min-w-0 flex-1 sm:w-44 sm:flex-none"
      />
      <Button
        type="button"
        variant="surface"
        size="icon"
        aria-label="Nächster Tag"
        tooltip="Zeigt die Übersicht für den nächsten Tag."
        onClick={() => shiftDay(1)}
        className="shrink-0"
      >
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

function ClassDayOverviewLoading() {
  return (
    <SectionCard>
      <div className="grid gap-3 lg:grid-cols-2">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    </SectionCard>
  );
}

export function ClassDayOverview({ notices, ...props }: ClassDayOverviewProps) {
  const greeting = useTimeBasedGreeting();
  const { data: session } = useSession();
  const greetingName = getGreetingName(session);

  return (
    <TenantPage
      title={greetingName ? `${greeting}, ${greetingName}` : greeting}
      prominent
      info={
        <Suspense fallback={null}>
          <ClassDayOverviewInfo />
        </Suspense>
      }
      actions={
        <Suspense fallback={null}>
          <ClassDayOverviewActions />
        </Suspense>
      }
    >
      {notices}
      <Suspense fallback={<ClassDayOverviewLoading />}>
        {hasPermission(session, "class_day:all_classes") ? (
          <SchoolDayOverviewContent {...props} />
        ) : (
          <AssignedClassesContent
            fetchAssignedClasses={props.fetchAssignedClasses}
          />
        )}
      </Suspense>
    </TenantPage>
  );
}

function AssignedClassesContent({
  fetchAssignedClasses,
}: Pick<ClassDayOverviewProps, "fetchAssignedClasses">) {
  const dateISO = classDayDateParam(useSearchParams().get("tag"));
  const key = schoolPortalKeys.assignedClasses(dateISO);
  const { data, error, isLoading, mutate } = useSWRAuth(
    key,
    () => fetchAssignedClasses(dateISO),
    {
      revalidateOnFocus: true,
      focusThrottleInterval: REPORT_FOCUS_THROTTLE_MS,
      keepPreviousData: false,
    },
  );
  useSchoolReportRefusal(error, key);
  useClassDayRefresh(useCallback(() => void mutate(), [mutate]));
  const { error: loadError } = useSwrResourceLoadError(
    [{ data, error }],
    "die Liste deiner Klassen",
    mutate,
  );
  if (!data && isLoading) return <ClassDayOverviewLoading />;

  const classes = data?.classes ?? [];
  return (
    <SectionCard>
      <LoadErrorAlert error={loadError} className="mt-4" />
      {data &&
        (classes.length === 0 ? (
          <NoAssignedClasses />
        ) : !data.school_day ? (
          <NoSchoolDay />
        ) : (
          <>
            <SectionLabel className="mt-5">Deine Klassen</SectionLabel>
            <div className="mt-2 grid gap-3 lg:grid-cols-2">
              {classes.map((klass) => (
                <ClassLink
                  key={klass.school_class}
                  klass={klass.school_class}
                  report={{
                    school_day: data.school_day,
                    enrollment_known: data.enrollment_known,
                    totals: klass.totals,
                    changes: klass.changes,
                  }}
                  weekend={false}
                  dateISO={dateISO}
                  openList={null}
                />
              ))}
            </div>
          </>
        ))}
    </SectionCard>
  );
}

function NoAssignedClasses() {
  return (
    <EmptyState
      className="mt-4"
      title="Keine Klassen zugewiesen"
      description="Deinem Konto ist noch keine Klasse zugeordnet. Die OGS-Verwaltung kann dir Klassen unter Mitarbeitende zuweisen."
    />
  );
}

function NoSchoolDay() {
  return (
    <EmptyState
      className="mt-4"
      title="Kein Schultag"
      description="Für Samstag und Sonntag gibt es keine Übergabe. Bitte einen Wochentag wählen."
    />
  );
}

function SchoolDayOverviewContent({
  fetchClasses,
  fetchSchoolDay,
  reportAbsence,
  withdrawAbsenceReport,
}: Omit<ClassDayOverviewProps, "notices" | "fetchAssignedClasses">) {
  const searchParams = useSearchParams();
  // Der Tag steht in der Adresse, nicht nur im Zustand: nur so führt der
  // Zurück-Weg aus einer Klasse auf denselben Tag zurück.
  const dateISO = classDayDateParam(searchParams.get("tag"));
  const openList = schoolDayListParam(searchParams.get("liste"));
  const {
    data: classList,
    error: classesError,
    isLoading: classesLoading,
    mutate: reloadClasses,
  } = useSWRAuth(schoolPortalKeys.classDayClasses(), fetchClasses, {
    revalidateOnFocus: true,
    focusThrottleInterval: REPORT_FOCUS_THROTTLE_MS,
  });
  const classes = classList?.classes;
  const weekend =
    isWeekendISO(dateISO) && classList?.weekend_follows_friday !== true;
  const schoolMode =
    fetchSchoolDay !== undefined && classList?.can_view_school_day === true;

  const schoolDayKey = schoolPortalKeys.schoolDay(dateISO);

  // Die Tagesübersicht der Schule: dieselbe Fokus-Revalidierung wie die
  // Klassenreports, und der Server protokolliert sie wie diese nur einmal
  // pro Person, Tag und Zugriffstag.
  const {
    data: schoolDay,
    error: schoolDayError,
    isLoading: schoolDayLoading,
    mutate: reloadSchoolDay,
  } = useSWRAuth(
    schoolMode && classes && classes.length > 0 && !weekend
      ? schoolDayKey
      : null,
    () =>
      fetchSchoolDay
        ? fetchSchoolDay(dateISO)
        : Promise.reject(new Error("school day not available")),
    {
      revalidateOnFocus: true,
      focusThrottleInterval: REPORT_FOCUS_THROTTLE_MS,
      keepPreviousData: false,
    },
  );

  const discardRefusedSchoolDay = useSchoolReportRefusal(
    schoolDayError,
    schoolDayKey,
  );
  // Nach einer Meldung lädt die Tagesübersicht direkt nach: ein Fehler dabei
  // weist ab und steht als Ladefehler über der Übersicht (#6652).
  const schoolDayAfterWrite = useRefreshAfterWrite(
    "die Anzeige des Schultags",
    async () => {
      try {
        await (fetchSchoolDay
          ? reloadSchoolDay(fetchSchoolDay(dateISO), { revalidate: false })
          : reloadSchoolDay());
      } catch (err) {
        discardRefusedSchoolDay(err);
        throw err;
      }
    },
  );

  // Eine neue Krankmeldung aktualisiert die Tagesübersicht der Schule (#4792).
  const refreshReports = useCallback(
    () => void reloadSchoolDay(),
    [reloadSchoolDay],
  );
  useClassDayRefresh(refreshReports);

  const absenceReports = useSchoolAbsenceReports({
    dateISO,
    report: reportAbsence,
    withdraw: withdrawAbsenceReport,
    onChanged: schoolDayAfterWrite.refresh,
    onRejected: refreshReports,
  });
  const canReportAbsences =
    absenceReports.available && schoolDay?.can_report_absences === true;

  const { withdrawTarget, closeWithdraw } = absenceReports;
  useLayoutEffect(() => {
    if (!canReportAbsences && withdrawTarget) closeWithdraw();
  }, [canReportAbsences, withdrawTarget, closeWithdraw]);

  const reports = useMemo(
    () => (schoolDay ? schoolDayLines(schoolDay) : {}),
    [schoolDay],
  );
  const loading =
    classesLoading ||
    (schoolMode && !weekend && schoolDay === undefined && schoolDayLoading);
  const { error: classesLoadError } = useSwrResourceLoadError(
    [{ data: classList, error: classesError }],
    "die Liste deiner Klassen",
    reloadClasses,
  );
  const { error: schoolDayLoadError } = useSwrResourceLoadError(
    [{ data: schoolDay, error: schoolMode ? schoolDayError : undefined }],
    "die Tagesübersicht der Schule",
    reloadSchoolDay,
  );
  const loadError = classesLoadError ?? schoolDayLoadError;
  const hasLoadFailure = Boolean(loadError);

  const noClasses = classes !== undefined && classes.length === 0;

  // Die Zahlen der ganzen Schule für die Schulverwaltung (#4802). Jede Zahl
  // ist ein Link auf dieselbe Seite mit `?liste=…`: darunter stehen dann die
  // Kinder dieser Zahl, nach Klasse gruppiert. Ein echter Seitenwechsel im
  // selben Fenster, keine versteckte Schaltfläche, und der Zurück-Weg aus
  // einer Klasse landet wieder bei der Liste.
  const schoolLists = schoolDay ? visibleSchoolDayLists(schoolDay) : [];
  const open = schoolLists.find((list) => list.key === openList) ?? null;
  const groups =
    schoolDay && open ? schoolDayChildrenByClass(schoolDay, open) : [];

  return (
    <>
      <SectionCard>
        <div
          className="contents"
          style={
            {
              "--class-day-blue": MOTO_COLOR_PALETTE.blue.base,
            } as CSSProperties
          }
        >
          {noClasses && <NoAssignedClasses />}

          {!noClasses && loading && (
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}

          {/* Without a snapshot, show the error instead of an empty grid. */}
          {!noClasses &&
            !loading &&
            hasLoadFailure &&
            Object.keys(reports).length === 0 &&
            !weekend && <LoadErrorAlert error={loadError} className="mt-4" />}

          {!noClasses &&
            !loading &&
            (weekend || Object.keys(reports).length > 0) && (
              <>
                {hasLoadFailure && Object.keys(reports).length > 0 && (
                  <LoadErrorAlert error={loadError} className="mt-4" />
                )}
                <LoadErrorAlert
                  error={schoolDayAfterWrite.error}
                  className="mt-4"
                />

                {weekend ? (
                  <NoSchoolDay />
                ) : (
                  <>
                    {schoolMode && schoolDay && (
                      <>
                        <SectionLabel className="mt-5">
                          Ganze Schule
                        </SectionLabel>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          {schoolLists.map((list) => (
                            <StatCard
                              key={list.key}
                              variant="row"
                              label={list.label}
                              value={list.count(schoolDay.totals)}
                              href={schoolPath(
                                schoolDayListPath(dateISO, list.key),
                              )}
                            />
                          ))}
                        </div>
                        {open && (
                          <div className="mt-4">
                            <div className="flex items-center justify-between gap-3">
                              <h3 className="text-sm font-semibold text-gray-900">
                                {open.label}: {open.count(schoolDay.totals)}
                              </h3>
                              <ButtonLink
                                href={schoolPath(
                                  schoolDayListPath(dateISO, null),
                                )}
                                variant="ghost"
                                size="compact"
                                noTooltip="Klappt nur die offene Liste zu, sonst ändert sich nichts."
                              >
                                Liste schließen
                              </ButtonLink>
                            </div>
                            {/* Bei offener Rückfrage steht der Fehler dort. */}
                            <FormErrorAlert
                              message={
                                absenceReports.withdrawTarget
                                  ? null
                                  : absenceReports.error
                              }
                              className="mt-2"
                            />
                            {open.key === "ohne-meldung" && (
                              <p className="mt-1 text-sm text-gray-600">
                                Die Lehrkraft hat diese Kinder als fehlend
                                eingetragen. Es gibt keine Krankmeldung.
                                {canReportAbsences
                                  ? " Rufen die Eltern an, trage die Meldung hier ein."
                                  : ""}
                              </p>
                            )}
                            {groups.length === 0 ? (
                              <p className="mt-2 text-sm text-gray-500">
                                An diesem Tag stehen keine Kinder in dieser
                                Liste.
                              </p>
                            ) : (
                              <div className="mt-2 grid gap-3 lg:grid-cols-2">
                                {groups.map((group) => (
                                  <InsetPanel
                                    key={group.schoolClass}
                                    padding="compact"
                                  >
                                    <NavigationLink
                                      href={schoolPath(
                                        schoolDayClassPath(
                                          group.schoolClass,
                                          dateISO,
                                          open.key,
                                        ),
                                      )}
                                      className="text-sm font-semibold text-gray-900 underline-offset-2 hover:underline"
                                    >
                                      {schoolClassLabel(group.schoolClass)} ·{" "}
                                      {group.children.length}
                                    </NavigationLink>
                                    <ul className="mt-1 space-y-0.5 text-sm text-gray-700">
                                      {group.children.map((child) => {
                                        const note = childNote(child, open.key);
                                        const target = {
                                          schoolClass: group.schoolClass,
                                          child,
                                        };
                                        const menu = absenceReportMenu(
                                          child,
                                          canReportAbsences,
                                          (status) =>
                                            void absenceReports.enter(
                                              target,
                                              status,
                                            ),
                                          () =>
                                            absenceReports.askWithdraw(target),
                                        );
                                        return (
                                          <li
                                            key={
                                              child.list_entry
                                                ? `entry-${child.list_entry_id}`
                                                : `student-${child.student_id}`
                                            }
                                            className="flex min-w-0 items-center justify-between gap-2"
                                          >
                                            <span className="min-w-0">
                                              {child.last_name},{" "}
                                              {child.first_name}
                                              {note && (
                                                <span className="text-gray-500">
                                                  {" "}
                                                  · {note}
                                                </span>
                                              )}
                                            </span>
                                            {menu.length > 0 && (
                                              <OverflowMenu
                                                items={menu}
                                                ariaLabel={
                                                  child.unreported
                                                    ? `Meldung für ${child.first_name} ${child.last_name} eintragen`
                                                    : `Meldung für ${child.first_name} ${child.last_name} zurücknehmen`
                                                }
                                                triggerSize="sm"
                                                triggerContent={
                                                  absenceReports.isPending(
                                                    target,
                                                  )
                                                    ? "Wird gespeichert …"
                                                    : child.unreported
                                                      ? "Meldung eintragen"
                                                      : "Zurücknehmen"
                                                }
                                              />
                                            )}
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  </InsetPanel>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                    {classes !== undefined && (
                      <>
                        <SectionLabel className="mt-5">
                          Alle Klassen
                        </SectionLabel>
                        <div className="mt-2 grid gap-3 lg:grid-cols-2">
                          {classes.map((klass) => (
                            <ClassLink
                              key={klass}
                              klass={klass}
                              report={reports[klass] ?? null}
                              weekend={weekend}
                              dateISO={dateISO}
                              openList={openList}
                            />
                          ))}
                        </div>
                      </>
                    )}
                  </>
                )}
              </>
            )}
        </div>
      </SectionCard>
      <ConfirmationModal
        isOpen={canReportAbsences && absenceReports.withdrawTarget !== null}
        onClose={absenceReports.closeWithdraw}
        onConfirm={() => void absenceReports.confirmWithdraw()}
        title="Meldung zurücknehmen?"
        confirmText="Zurücknehmen"
        isConfirmLoading={absenceReports.withdrawing}
        loadingText="Wird zurückgenommen …"
      >
        <FormErrorAlert message={absenceReports.error} className="mb-3" />
        <p className="text-sm text-gray-700">
          {absenceReports.withdrawTarget
            ? `${absenceReports.withdrawTarget.child.first_name} ${absenceReports.withdrawTarget.child.last_name} steht dann wieder unter „Fehlen ohne Meldung“. Die OGS sieht den Status nicht mehr.`
            : null}
        </p>
      </ConfirmationModal>
    </>
  );
}
