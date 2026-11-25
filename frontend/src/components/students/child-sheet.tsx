"use client";

// Kind-Blatt (#8070): Schnellinfos und Schnellaktionen eines Kindes, ohne die
// Liste zu verlassen. Am Telefon ein Blatt (halb, hochziehbar), am iPad eine
// Karte; im iPad-Querformat steht derselbe Inhalt (`ChildSummary`) rechts
// neben der Liste. Andere Listen (Aufsicht, Gruppen) nutzen es mit eigenen
// Kontext-Aktionen.

import { AlertTriangle } from "lucide-react";
import { getAccessibleTextColor } from "~/lib/kit-palette";
import { useMinuteClock } from "~/lib/pickup-helpers";
import {
  getStudentDayTimes,
  getStudentTimeStatus,
} from "~/lib/student-time-status";
import { useSession } from "next-auth/react";
import type { ReactNode } from "react";

import { Avatar } from "~/components/ui/avatar";
import { Button, ButtonLink } from "~/components/ui/button";
import { DataField, DataGrid } from "~/components/ui/data-field";
import { OverlaySheet } from "~/components/ui/overlay-sheet";
import { SectionLabel } from "~/components/ui/section-label";
import { StatusBadge } from "~/components/ui/status-badge";
import { dailyDepartureLabelForStudent } from "~/components/students/search-student-card";
import {
  CHILD_DAY_TONE_BADGE,
  childDayStatus,
  type ChildDayStatus,
} from "~/components/students/child-day-status";
import {
  studentQuickActionHref,
  type StudentQuickAction,
} from "~/components/students/requested-quick-action";
import { hasPermission } from "~/lib/auth-utils";
import { useStudentData } from "~/lib/hooks/use-student-data";
import { isNotCheckedInLocation, parseLocation } from "~/lib/location-helper";
import {
  teacherHintKey,
  teacherHintText,
  type Student,
} from "~/lib/student-helpers";
import { useTenantRouter } from "~/lib/tenant-router";
import { useAttendanceWebEnabled } from "~/lib/tenant-context";
import { cn } from "~/lib/utils";

export interface ChildSheetProps {
  /** Das Kind aus der Liste; `null` schließt das Blatt. */
  readonly student: Student | null;
  readonly onOpenChange: (open: boolean) => void;
  /**
   * Adresse der Akte samt Rückweg (`/students/7?from=…`). Ohne Adresse (kein
   * Recht, die Akte zu lesen) fehlen der Weg zur Akte und die Schnellaktionen.
   */
  readonly href?: string;
  /** `false` zeigt die Planung eines anderen Tages statt des Orts. */
  readonly isToday?: boolean;
  /** Klasse, wie die Liste sie nennt (Feriengäste). */
  readonly classLabel?: string | null | undefined;
  /** Aktionen der aufrufenden Liste (z. B. „Raum verlassen“). */
  readonly contextActions?: ReactNode;
  /**
   * Schnellaktionen der Akte (Anmelden, Abmelden, Krank, Entschuldigt).
   * `false`, wenn die Liste eigene Aktionen für denselben Schritt hat.
   */
  readonly quickActions?: boolean;
  /** Eigener Status statt des Tagesstatus; `null` blendet ihn aus (lädt noch). */
  readonly status?: ChildDayStatus | null;
  /**
   * Knöpfe der aufrufenden Liste in der Fußleiste, über „Ganze Akte öffnen“
   * (z. B. „Raum verlassen“). Dann ist die Akte der Nebenweg.
   */
  readonly footerActions?: ReactNode;
}

/** Das Blatt: halbe Höhe am Telefon, Karte am iPad. */
export function ChildSheet({
  student,
  onOpenChange,
  href,
  isToday = true,
  classLabel,
  contextActions,
  quickActions = true,
  status,
  footerActions,
}: ChildSheetProps) {
  const akteLink = href ? (
    <ButtonLink
      href={href}
      // Das Blatt trägt einen eigenen Verlaufseintrag (gleiche Adresse
      // wie die Liste). Die Akte ersetzt ihn: Zurück führt dann direkt
      // auf die Liste mit ihrer Scroll-Position, nicht auf einen leeren
      // Blatt-Eintrag.
      replace
      variant="outline"
      size="md"
      className="w-full"
      tooltip="Öffnet die ganze Akte mit allen Angaben."
    >
      Ganze Akte öffnen
    </ButtonLink>
  ) : null;
  const footerQuickActions =
    student && isToday && quickActions && href ? (
      <ChildQuickActions student={student} href={href} replaceEntry />
    ) : null;
  return (
    <OverlaySheet
      open={student !== null}
      onOpenChange={onOpenChange}
      title={student ? studentName(student) : "Kind"}
      closeLabel="Kind-Blatt schließen"
      // Alle Aktionen im Fuß, in Daumennähe, wie im Kind-Blatt der
      // Aufsicht: die Aktionen der Liste bzw. die Schnellaktionen der Akte
      // zuerst, die Akte als Nebenweg darunter.
      footer={
        footerActions || footerQuickActions ? (
          <div
            className={cn(
              "flex w-full flex-col gap-2",
              // Die App legt Fußknöpfe in eine Reihe; drei Schnellaktionen
              // und die Akte passen nicht nebeneinander, sie stehen darum
              // untereinander (Hauptaktion oben, Akte als Nebenweg unten).
              footerQuickActions && "app:flex-col!",
            )}
          >
            {footerActions}
            {footerQuickActions}
            {akteLink}
          </div>
        ) : (
          (akteLink ?? undefined)
        )
      }
    >
      {student ? (
        <ChildSummary
          student={student}
          href={href}
          isToday={isToday}
          classLabel={classLabel}
          contextActions={contextActions}
          quickActions={false}
          status={status}
          replaceEntry
        />
      ) : null}
    </OverlaySheet>
  );
}

function studentName(student: Student): string {
  return (
    `${student.first_name ?? ""} ${student.second_name ?? ""}`.trim() ||
    student.name
  );
}

/**
 * Inhalt des Blatts: Status, Aktionen, dann die Angaben des Tages. Zeigt nur,
 * was die Liste über das Kind schon weiß.
 */
export function ChildSummary({
  student,
  href,
  isToday = true,
  classLabel,
  contextActions,
  quickActions = true,
  status: statusOverride,
  header = false,
  headerAction,
  replaceEntry = false,
  actionsLast = false,
}: Readonly<{
  student: Student;
  /** Ohne Adresse keine Schnellaktionen (sie öffnen die Akte). */
  href?: string;
  isToday?: boolean;
  classLabel?: string | null;
  contextActions?: ReactNode;
  /** Schnellaktionen der Akte zeigen (siehe `ChildSheet`). */
  quickActions?: boolean;
  /** Eigener Status statt des Tagesstatus; `null` blendet ihn aus. */
  status?: ChildDayStatus | null;
  /** Name und Foto oben (Detail neben der Liste; das Blatt hat einen Titel). */
  header?: boolean;
  /** Rechts neben dem Namen, etwa „Ganze Akte öffnen“ (nur mit `header`). */
  headerAction?: ReactNode;
  /** Im Blatt: Die Akte ersetzt dessen Verlaufseintrag (siehe `ChildSheet`). */
  replaceEntry?: boolean;
  /**
   * Aktionen unter den Angaben statt darüber (Detail neben der Liste): Sie
   * stehen dann wie im Blatt am Fuß, nahe der Aktionsleiste.
   */
  actionsLast?: boolean;
}>) {
  const status =
    statusOverride === undefined
      ? childDayStatus(student, isToday)
      : statusOverride;
  const fullAccess = student.has_full_access !== false;
  // Der Raum steht in der Liste nicht (dort zählt die Gehzeit), hier schon.
  const room = isToday
    ? parseLocation(student.current_location).room
    : undefined;
  const hints = [
    ...(student.teacher_hints ?? []).map((hint) => ({
      key: teacherHintKey(hint),
      text: teacherHintText(hint),
    })),
    ...(fullAccess && student.pickup_notes
      ? [{ key: "pickup-notes", text: student.pickup_notes }]
      : []),
  ];
  const actions = (
    <>
      {contextActions}
      {isToday && quickActions && href ? (
        <ChildQuickActions
          student={student}
          href={href}
          replaceEntry={replaceEntry}
        />
      ) : null}
    </>
  );
  return (
    <div className="space-y-3">
      {header ? (
        <div className="flex items-center gap-3">
          <Avatar
            imageUrl={student.photo_url ?? null}
            name={studentName(student)}
            size="md"
            decorative
          />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold text-gray-900">
              {studentName(student)}
            </h2>
            {status ? (
              <StatusBadge
                label={status.value}
                tone={CHILD_DAY_TONE_BADGE[status.tone]}
              />
            ) : null}
          </div>
          {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
        </div>
      ) : status ? (
        <StatusBadge
          label={status.value}
          tone={CHILD_DAY_TONE_BADGE[status.tone]}
        />
      ) : null}
      {actionsLast ? null : actions}
      <DataGrid columns={2} appRows>
        {room ? <DataField label="Raum">{room}</DataField> : null}
        <DataField label="Klasse">
          {classLabel ?? (student.school_class || "–")}
        </DataField>
        <DataField label="Gruppe">{student.group_name || "–"}</DataField>
        {fullAccess ? (
          <>
            <DataField label="Ankunft heute">
              <OverdueTime student={student} kind="arrival" isToday={isToday}>
                {arrivalText(student)}
              </OverdueTime>
            </DataField>
            <DataField label="Gehen heute">
              <OverdueTime student={student} kind="pickup" isToday={isToday}>
                {pickupText(student)}
              </OverdueTime>
            </DataField>
            <DataField label="Heimweg">
              {dailyDepartureLabelForStudent(student)}
            </DataField>
          </>
        ) : null}
      </DataGrid>
      {hints.length > 0 ? (
        <section className="space-y-1.5">
          <SectionLabel as="h3">Hinweise</SectionLabel>
          <ul className="space-y-1 text-sm text-gray-700">
            {hints.map((hint) => (
              <li key={hint.key}>{hint.text}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {actionsLast ? (
        <div className="space-y-2 border-t border-gray-100 pt-3">{actions}</div>
      ) : null}
    </div>
  );
}

/**
 * Rot (bzw. orange), wenn die geplante Ankunft oder Abholung heute
 * überschritten ist, wie auf der Karte der Kindersuche; sonst der Text.
 */
function OverdueTime({
  student,
  kind,
  isToday,
  children,
}: Readonly<{
  student: Student;
  kind: "arrival" | "pickup";
  isToday: boolean;
  children: ReactNode;
}>) {
  const now = useMinuteClock();
  if (!isToday) return <>{children}</>;
  const status = getStudentTimeStatus({
    plannedTime:
      kind === "arrival"
        ? student.arrival_time
        : (student.pickup_time ?? undefined),
    actualTime:
      kind === "arrival"
        ? student.actual_arrival_time
        : student.actual_pickup_time,
    now,
    kind,
    day: getStudentDayTimes(student),
    sick: student.sick,
    classTrip: student.class_trip,
    excused: student.excused,
    currentLocation: student.current_location,
  });
  const late =
    status.state === "very-overdue" || status.state === "slightly-overdue";
  if (!late || !status.textColor) return <>{children}</>;
  return (
    <span
      className="inline-flex items-center gap-1.5"
      style={{ color: getAccessibleTextColor(status.textColor) }}
    >
      <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
      {children}, überfällig
    </span>
  );
}

// „07:40, später als geplant (07:30)“: Was tatsächlich war, steht
// vorn, der Plan ordnet es ein; ohne Ankunft nur der Plan.
function arrivalText(student: Student): string {
  const actual = student.actual_arrival_time;
  const planned = student.arrival_time;
  if (actual) {
    if (!planned || planned === actual) return `Gekommen ${actual}`;
    // Uhrzeiten als „HH:MM“ lassen sich als Text vergleichen.
    const relation = actual < planned ? "früher" : "später";
    return `${actual}, ${relation} als geplant (${planned})`;
  }
  return student.arrival_time ? `Kommt ${student.arrival_time}` : "–";
}

function pickupText(student: Student): string {
  if (student.actual_pickup_time) {
    return `Gegangen ${student.actual_pickup_time}`;
  }
  return student.pickup_time ? `Geht ${student.pickup_time}` : "–";
}

/**
 * Dieselben Schnellaktionen wie oben in der Akte, mit denselben Rechten. Ein
 * Tipp öffnet die Akte mit dem Dialog der Aktion: Rückfragen und Fehlerwege
 * gibt es so nur einmal.
 */
function ChildQuickActions({
  student,
  href,
  replaceEntry,
}: Readonly<{ student: Student; href: string; replaceEntry: boolean }>) {
  const router = useTenantRouter();
  const { data: session, status } = useSession();
  // Dieselbe Abfrage wie die Akte: Die Rechte am Kind stehen nur dort, und
  // die Akte öffnet danach ohne Laden.
  const detail = useStudentData(student.id.toString());
  const canCheckin =
    status === "authenticated" && hasPermission(session, "users:checkin");
  const withoutCarePlace = student.without_care_place === true;
  const notCheckedIn = isNotCheckedInLocation(student.current_location);
  // Wie die Kacheln der Akte: An- und Abmelden nur mit Anwesenheit im Web.
  const attendanceWebEnabled = useAttendanceWebEnabled();
  const showCheckout =
    attendanceWebEnabled && canCheckin && !withoutCarePlace && !notCheckedIn;
  const showCheckin =
    attendanceWebEnabled && canCheckin && !withoutCarePlace && notCheckedIn;
  const sickExcused = detail.hasSickExcusedWriteAccess;
  if (!showCheckout && !showCheckin && !sickExcused) return null;
  const open = (action: StudentQuickAction) => () =>
    replaceEntry
      ? router.replace(studentQuickActionHref(href, action))
      : router.push(studentQuickActionHref(href, action));
  const isQuickExcused = (student.excused ?? false) && !student.class_trip;
  // Knöpfe statt hoher Kacheln: Das Blatt bleibt kompakt. Wie die
  // Aktionsleiste der Akte nach dem Zustand des Kindes: Ist es da, ist das
  // Abmelden die eine Aktion („Krank melden“ passte nicht zu einem Kind, das
  // da ist). Ist es nicht da, stehen Anmelden und „Krank melden“
  // nebeneinander. Entschuldigen und alles Weitere stehen in der Akte.
  const sickButton = (
    <Button
      type="button"
      variant="outline"
      size="md"
      className="flex-1"
      onClick={open("krank")}
      tooltip="Öffnet die Akte und fragt dort vor dem Speichern nach."
    >
      {student.sick ? "Gesund melden" : "Krank melden"}
    </Button>
  );
  return (
    <div className="flex gap-2" aria-label="Schnellaktionen">
      {showCheckout ? (
        <Button
          type="button"
          variant="primary"
          size="md"
          className="flex-1"
          onClick={open("abmelden")}
          tooltip="Öffnet die Akte und fragt dort vor dem Abmelden nach."
        >
          Abmelden
        </Button>
      ) : null}
      {!showCheckout && sickExcused ? sickButton : null}
      {showCheckin ? (
        <Button
          type="button"
          variant="primary"
          size="md"
          className="flex-1"
          onClick={open("anmelden")}
          tooltip="Öffnet die Akte und fragt dort vor dem Anmelden nach."
        >
          Anmelden
        </Button>
      ) : null}
      {!showCheckout && !showCheckin && sickExcused ? (
        <Button
          type="button"
          variant="outline"
          size="md"
          className="flex-1"
          onClick={open("entschuldigen")}
          tooltip="Öffnet die Akte und fragt dort vor dem Speichern nach."
        >
          {isQuickExcused ? "Entschuldigung aufheben" : "Entschuldigen"}
        </Button>
      ) : null}
    </div>
  );
}
