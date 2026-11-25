"use client";

// Kinderliste der App (#8070): dieselben Kinder wie die Kartenansicht der
// Kindersuche, als Zeilen in EINER Karte. Ohne eigene Gruppierung stehen sie
// nach dem Anfangsbuchstaben des Nachnamens unter klebenden Köpfen: Die
// Aufgabe ist „ein Kind in 5 Sekunden finden“, und die Liste ist nach
// Nachnamen sortiert. Wer nach Status, Raum oder Gehzeit sehen will, wählt
// die Gruppierung im Filter; dann übernimmt die Liste deren Gruppen.
//
// Ein Tipp öffnet das Kind-Blatt (Telefon, iPad hoch), im iPad-Querformat
// steht das Kind rechts neben der Liste (`?kind=<id>`).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, StickyNote } from "lucide-react";

import { Avatar } from "~/components/ui/avatar";
import { ButtonLink } from "~/components/ui/button";
import {
  Collection,
  CollectionGroup,
  CollectionList,
  CollectionRow,
} from "~/components/ui/collection";
import { IndexRail } from "~/components/ui/index-rail";
import { SectionCard } from "~/components/ui/section-card";
import { SplitView, useSplitSelection } from "~/components/ui/split-view";
import { ChildSheet, ChildSummary } from "~/components/students/child-sheet";
import { SearchStudentStatusBadge } from "~/components/students/search-student-card";
import { useRowClock } from "~/components/students/student-card-clock";
import { useDeviceContext } from "~/lib/device-context";
import { getAccessibleTextColor } from "~/lib/kit-palette";
import type { DepartureMode } from "~/lib/departure-plan";
import { teacherHintText, type Student } from "~/lib/student-helpers";
import {
  getStudentDayTimes,
  getStudentTimeStatus,
} from "~/lib/student-time-status";

export interface StudentListAppGroup {
  readonly key: string;
  readonly label: string;
  readonly items: readonly Student[];
}

// Heimweg in der zweiten Zeile: kurz genug, dass Klasse und Gruppe daneben
// stehen bleiben („2b · Mondgruppe · Bus“).
const SHORT_DEPARTURE_LABELS: Record<DepartureMode, string> = {
  alone: "Geht alleine",
  bus: "Bus",
  pickup: "Abholung",
  accompanied: "Mit Kind",
};

function shortDepartureLabel(student: Student): string | null {
  if (student.has_full_access === false) return null;
  const legacy = student.departure_label?.trim();
  if (legacy) return legacy;
  const modes = student.departure_modes ?? [];
  if (modes.length === 0) return null;
  return modes.map((mode) => SHORT_DEPARTURE_LABELS[mode]).join(", ");
}

/**
 * Dritte Zeile, nur wenn es etwas zu sagen gibt (wie heute auf der Karte):
 * eine überschrittene Ankunfts- oder Gehzeit in Rot bzw. Orange, sonst der
 * Hinweis der Lehrkraft. Eine Zeile, damit die Liste dicht bleibt; alles
 * Weitere steht im Kind-Blatt.
 */
function RowHint({
  student,
  isToday,
}: Readonly<{ student: Student; isToday: boolean }>) {
  const now = useRowClock(undefined);
  if (student.has_full_access === false) return null;
  if (isToday) {
    const day = getStudentDayTimes(student);
    const absence = {
      sick: student.sick,
      classTrip: student.class_trip,
      excused: student.excused,
      currentLocation: student.current_location,
    };
    const overdue = (
      [
        [
          "Ankunftszeit",
          "arrival",
          student.arrival_time,
          student.actual_arrival_time,
        ],
        [
          "Gehzeit",
          "pickup",
          student.pickup_time ?? undefined,
          student.actual_pickup_time,
        ],
      ] as const
    )
      .map(([label, kind, plannedTime, actualTime]) => ({
        label,
        status: getStudentTimeStatus({
          plannedTime,
          actualTime,
          now,
          kind,
          day,
          ...absence,
        }),
      }))
      .find(
        ({ status }) =>
          status.state === "very-overdue" ||
          status.state === "slightly-overdue",
      );
    if (overdue?.status.textColor) {
      const color = getAccessibleTextColor(overdue.status.textColor);
      return (
        <span
          className="mt-0.5 flex min-w-0 items-center gap-1 text-xs leading-4"
          style={{ color }}
        >
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate font-medium">
            {overdue.label}: {overdue.status.displayTime} Uhr
          </span>
        </span>
      );
    }
  }
  const hint = student.teacher_hints?.[0];
  if (!hint) return null;
  return (
    <span className="mt-0.5 flex min-w-0 items-center gap-1 text-xs leading-4 text-gray-600">
      <StickyNote className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{teacherHintText(hint)}</span>
    </span>
  );
}

function studentName(student: Student): string {
  return (
    `${student.first_name ?? ""} ${student.second_name ?? ""}`.trim() ||
    student.name
  );
}

/** Erster Buchstabe des Nachnamens, Umlaute unter ihrem Grundbuchstaben. */
function initialOf(student: Student): string {
  const source = (student.second_name ?? student.name ?? "").trim();
  const letter = source
    .charAt(0)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();
  return /[A-Z]/.test(letter) ? letter : "#";
}

function alphabeticGroups(students: readonly Student[]): StudentListAppGroup[] {
  const groups = new Map<string, Student[]>();
  for (const student of students) {
    const letter = initialOf(student);
    const items = groups.get(letter);
    if (items) items.push(student);
    else groups.set(letter, [student]);
  }
  return [...groups].map(([letter, items]) => ({
    key: letter,
    label: letter,
    items,
  }));
}

export function StudentListApp({
  students,
  groups,
  alphabetic,
  isToday,
  studentHref,
  classLabel,
  userGroups,
  groupRooms,
  supervisedRooms,
}: Readonly<{
  /** Sortiert, gefiltert: genau die Kinder der Seite. */
  students: readonly Student[];
  /** Gruppen der gewählten Gruppierung; leer ohne Gruppierung. */
  groups: readonly StudentListAppGroup[];
  /** Ohne Gruppierung nach Namen sortiert: Buchstabenköpfe. */
  alphabetic: boolean;
  isToday: boolean;
  studentHref: (student: Student) => string;
  classLabel: (student: Student) => string | null | undefined;
  /** Für das Orts-Abzeichen wie auf der Karte (eigene Räume grün). */
  userGroups: string[];
  groupRooms: string[];
  supervisedRooms: string[];
}>) {
  const { selected, select } = useSplitSelection("kind");
  const [sheetId, setSheetId] = useState<string | null>(null);
  const byId = useMemo(
    () => new Map(students.map((student) => [student.id.toString(), student])),
    [students],
  );
  const shownGroups = useMemo(() => {
    if (groups.length > 0) return groups;
    return alphabetic ? alphabeticGroups(students) : [];
  }, [groups, alphabetic, students]);

  const { isSplit } = useDeviceContext();
  // iPad quer: Die Detailspalte ist nie leer, das erste Kind steht vorgewählt.
  const firstId = (shownGroups[0]?.items[0] ?? students[0])?.id.toString();
  useEffect(() => {
    if (isSplit && !selected && firstId) select(firstId);
  }, [isSplit, selected, firstId, select]);

  const row = (student: Student) => {
    const id = student.id.toString();
    // „1b · Sternengruppe“: Das Wort „Klasse“ kostet am schmalen Telefon
    // den Platz, an dem sonst der Gruppenname abgeschnitten würde.
    const klass = (classLabel(student) ?? student.school_class)?.replace(
      /^Klasse\s+/,
      "",
    );
    const homeway = shortDepartureLabel(student);
    const subtitle = [klass, student.group_name, homeway]
      .filter(Boolean)
      .join(" · ");
    // Telefon: dasselbe farbige Orts-Abzeichen wie auf der Karte von heute
    // („Zuhause“, „Kommt heute nicht“, Raumname), in der Namenszeile, damit
    // die zweite Zeile die ganze Breite hat.
    const badge = (
      <SearchStudentStatusBadge
        student={student}
        isToday={isToday}
        userGroups={userGroups}
        groupRooms={groupRooms}
        supervisedRooms={supervisedRooms}
        compact
      />
    );
    return (
      <CollectionRow
        key={id}
        leading={
          <Avatar
            imageUrl={student.photo_url ?? null}
            name={studentName(student)}
            size="sm"
            decorative
          />
        }
        title={
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">{studentName(student)}</span>
            <span className="ml-auto shrink-0">{badge}</span>
          </span>
        }
        subtitle={
          <>
            {subtitle ? (
              <span className="block truncate">{subtitle}</span>
            ) : null}
            <RowHint student={student} isToday={isToday} />
          </>
        }
        selected={selected === id}
        onClick={() => (isSplit ? select(id) : setSheetId(id))}
      />
    );
  };

  // Buchstaben-Sprungleiste (Telefon, iPad hoch): bei langen Namenslisten.
  const listRef = useRef<HTMLDivElement>(null);
  const railLetters =
    alphabetic && groups.length === 0 && !isSplit && shownGroups.length >= 5
      ? shownGroups.map((group) => group.label)
      : [];
  const scrollToLetter = useCallback((index: number) => {
    const group = listRef.current?.querySelectorAll<HTMLElement>(
      "[data-collection-group]",
    )[index];
    if (!group) return;
    const offset = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--app-sticky-offset",
      ) || "0",
    );
    window.scrollTo({
      top: group.getBoundingClientRect().top + window.scrollY - offset,
    });
  }, []);

  const list = (
    <Collection label="Kinder" className="phone:-mt-1.5">
      {shownGroups.length > 0 ? (
        shownGroups.map((group) => (
          <CollectionGroup
            key={group.key}
            title={group.label}
            count={group.items.length}
          >
            {group.items.map(row)}
          </CollectionGroup>
        ))
      ) : (
        <CollectionList>{students.map(row)}</CollectionList>
      )}
    </Collection>
  );
  const listWithRail =
    railLetters.length > 0 ? (
      // Die Leiste steht innen am rechten Kartenrand; die Zeilen lassen ihr
      // Platz, damit kein Abzeichen unter ihr liegt.
      <div ref={listRef} className="[&_[data-collection-row]]:pr-9">
        {list}
        <IndexRail letters={railLetters} onJump={scrollToLetter} />
      </div>
    ) : (
      list
    );

  const selectedStudent = selected ? (byId.get(selected) ?? null) : null;
  const sheetStudent = sheetId ? (byId.get(sheetId) ?? null) : null;

  return (
    <>
      <SplitView
        list={listWithRail}
        detail={
          selectedStudent ? (
            <SectionCard>
              <ChildSummary
                student={selectedStudent}
                href={studentHref(selectedStudent)}
                isToday={isToday}
                classLabel={classLabel(selectedStudent)}
                header
                actionsLast
              />
              {/* Wie im Blatt und in der Aufsicht: alle Aktionen unten
                  gebündelt, die Akte als Nebenweg darunter. */}
              <ButtonLink
                href={studentHref(selectedStudent)}
                variant="outline"
                size="md"
                className="mt-2 w-full"
                tooltip="Öffnet die ganze Akte mit allen Angaben."
              >
                Ganze Akte öffnen
              </ButtonLink>
            </SectionCard>
          ) : null
        }
        empty="Wähle links ein Kind, um seine Angaben zu sehen."
      />
      <ChildSheet
        student={sheetStudent}
        onOpenChange={(open) => {
          if (!open) setSheetId(null);
        }}
        href={sheetStudent ? studentHref(sheetStudent) : "/students/search"}
        isToday={isToday}
        classLabel={sheetStudent ? classLabel(sheetStudent) : null}
      />
    </>
  );
}
