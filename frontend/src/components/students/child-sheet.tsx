"use client";

// Kind-Blatt (#8070): Schnellinfos und Schnellaktionen eines Kindes, ohne die
// Liste zu verlassen. Am Telefon ein Blatt (halb, hochziehbar), am iPad eine
// Karte; im iPad-Querformat steht derselbe Inhalt (`ChildSummary`) rechts
// neben der Liste. Andere Listen (Aufsicht, Gruppen) nutzen es mit eigenen
// Kontext-Aktionen.

import { useSession } from "next-auth/react";
import type { ReactNode } from "react";

import { Avatar } from "~/components/ui/avatar";
import { ButtonLink } from "~/components/ui/button";
import { DataField, DataGrid } from "~/components/ui/data-field";
import { OverlaySheet } from "~/components/ui/overlay-sheet";
import { SectionLabel } from "~/components/ui/section-label";
import { StatusBadge } from "~/components/ui/status-badge";
import {
  StudentCheckinSection,
  StudentCheckoutSection,
  StudentExcusedReportSection,
  StudentSickReportSection,
} from "~/components/students/student-checkout-section";
import { dailyDepartureLabelForStudent } from "~/components/students/search-student-card";
import {
  CHILD_DAY_TONE_BADGE,
  childDayStatus,
} from "~/components/students/child-day-status";
import {
  studentQuickActionHref,
  type StudentQuickAction,
} from "~/components/students/requested-quick-action";
import { hasPermission } from "~/lib/auth-utils";
import { useStudentData } from "~/lib/hooks/use-student-data";
import { isNotCheckedInLocation } from "~/lib/location-helper";
import {
  teacherHintKey,
  teacherHintText,
  type Student,
} from "~/lib/student-helpers";
import { useTenantRouter } from "~/lib/tenant-router";

export interface ChildSheetProps {
  /** Das Kind aus der Liste; `null` schließt das Blatt. */
  readonly student: Student | null;
  readonly onOpenChange: (open: boolean) => void;
  /** Adresse der Akte samt Rückweg (`/students/7?from=…`). */
  readonly href: string;
  /** `false` zeigt die Planung eines anderen Tages statt des Orts. */
  readonly isToday?: boolean;
  /** Klasse, wie die Liste sie nennt (Feriengäste). */
  readonly classLabel?: string | null | undefined;
  /** Aktionen der aufrufenden Liste (z. B. „Raum verlassen“). */
  readonly contextActions?: ReactNode;
}

/** Das Blatt: halbe Höhe am Telefon, Karte am iPad. */
export function ChildSheet({
  student,
  onOpenChange,
  href,
  isToday = true,
  classLabel,
  contextActions,
}: ChildSheetProps) {
  return (
    <OverlaySheet
      open={student !== null}
      onOpenChange={onOpenChange}
      title={student ? studentName(student) : "Kind"}
      closeLabel="Kind-Blatt schließen"
      footer={
        <ButtonLink
          href={href}
          variant="primary"
          size="md"
          className="flex-1"
          tooltip="Öffnet die ganze Akte mit allen Angaben."
        >
          Ganze Akte öffnen
        </ButtonLink>
      }
    >
      {student ? (
        <ChildSummary
          student={student}
          href={href}
          isToday={isToday}
          classLabel={classLabel}
          contextActions={contextActions}
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
  header = false,
}: Readonly<{
  student: Student;
  href: string;
  isToday?: boolean;
  classLabel?: string | null;
  contextActions?: ReactNode;
  /** Name und Foto oben (Detail neben der Liste; das Blatt hat einen Titel). */
  header?: boolean;
}>) {
  const status = childDayStatus(student, isToday);
  const fullAccess = student.has_full_access !== false;
  const hints = [
    ...(student.teacher_hints ?? []).map((hint) => ({
      key: teacherHintKey(hint),
      text: teacherHintText(hint),
    })),
    ...(fullAccess && student.pickup_notes
      ? [{ key: "pickup-notes", text: student.pickup_notes }]
      : []),
  ];
  return (
    <div className="space-y-4">
      {header ? (
        <div className="flex items-center gap-3">
          <Avatar
            imageUrl={student.photo_url ?? null}
            name={studentName(student)}
            size="md"
            decorative
          />
          <h2 className="min-w-0 flex-1 truncate text-lg font-semibold text-gray-900">
            {studentName(student)}
          </h2>
        </div>
      ) : null}
      <StatusBadge
        label={status.value}
        tone={CHILD_DAY_TONE_BADGE[status.tone]}
      />
      {contextActions}
      {isToday ? <ChildQuickActions student={student} href={href} /> : null}
      <DataGrid columns={1}>
        <DataField label="Klasse" inline>
          {classLabel ?? (student.school_class || "–")}
        </DataField>
        <DataField label="Gruppe" inline>
          {student.group_name || "–"}
        </DataField>
        {fullAccess ? (
          <>
            <DataField label="Ankunft" inline>
              {arrivalText(student)}
            </DataField>
            <DataField label="Gehzeit" inline>
              {pickupText(student)}
            </DataField>
            <DataField label="Heimweg" inline>
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
    </div>
  );
}

function arrivalText(student: Student): string {
  if (student.actual_arrival_time) {
    return student.arrival_time
      ? `${student.actual_arrival_time} (geplant ${student.arrival_time})`
      : student.actual_arrival_time;
  }
  return student.arrival_time ? `${student.arrival_time} geplant` : "–";
}

function pickupText(student: Student): string {
  if (student.actual_pickup_time) {
    return `gegangen ${student.actual_pickup_time}`;
  }
  return student.pickup_time ?? "–";
}

/**
 * Dieselben Schnellaktionen wie oben in der Akte, mit denselben Rechten. Ein
 * Tipp öffnet die Akte mit dem Dialog der Aktion: Rückfragen und Fehlerwege
 * gibt es so nur einmal.
 */
function ChildQuickActions({
  student,
  href,
}: Readonly<{ student: Student; href: string }>) {
  const router = useTenantRouter();
  const { data: session, status } = useSession();
  // Dieselbe Abfrage wie die Akte: Die Rechte am Kind stehen nur dort, und
  // die Akte öffnet danach ohne Laden.
  const detail = useStudentData(student.id.toString());
  const canCheckin =
    status === "authenticated" && hasPermission(session, "users:checkin");
  const withoutCarePlace = student.without_care_place === true;
  const notCheckedIn = isNotCheckedInLocation(student.current_location);
  const showCheckout = canCheckin && !withoutCarePlace && !notCheckedIn;
  const showCheckin = canCheckin && !withoutCarePlace && notCheckedIn;
  const sickExcused = detail.hasSickExcusedWriteAccess;
  if (!showCheckout && !showCheckin && !sickExcused) return null;
  const open = (action: StudentQuickAction) => () =>
    router.push(studentQuickActionHref(href, action));
  const isQuickExcused = (student.excused ?? false) && !student.class_trip;
  return (
    <div className="flex gap-2" aria-label="Schnellaktionen">
      {showCheckout ? (
        <StudentCheckoutSection onCheckoutClick={open("abmelden")} />
      ) : null}
      {showCheckin ? (
        <StudentCheckinSection onCheckinClick={open("anmelden")} />
      ) : null}
      {sickExcused ? (
        <StudentSickReportSection
          isSick={student.sick ?? false}
          onToggle={open("krank")}
          isLoading={false}
        />
      ) : null}
      {sickExcused ? (
        <StudentExcusedReportSection
          isExcused={isQuickExcused}
          onToggle={open("entschuldigen")}
          isLoading={false}
        />
      ) : null}
    </div>
  );
}
