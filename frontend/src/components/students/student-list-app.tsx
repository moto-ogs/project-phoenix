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
import { StatusBadge } from "~/components/ui/status-badge";
import { ChildSheet, ChildSummary } from "~/components/students/child-sheet";
import { dailyDepartureLabelForStudent } from "~/components/students/search-student-card";
import {
  CHILD_DAY_TONE_BADGE,
  childDayStatus,
} from "~/components/students/child-day-status";
import { useDeviceContext } from "~/lib/device-context";
import type { Student } from "~/lib/student-helpers";

export interface StudentListAppGroup {
  readonly key: string;
  readonly label: string;
  readonly items: readonly Student[];
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
    const status = childDayStatus(student, isToday);
    // „1b · Sternengruppe“: Das Wort „Klasse“ kostet am schmalen Telefon
    // den Platz, an dem sonst der Gruppenname abgeschnitten würde.
    const klass = (classLabel(student) ?? student.school_class)?.replace(
      /^Klasse\s+/,
      "",
    );
    const subtitle = [klass, student.group_name].filter(Boolean).join(" · ");
    const departure =
      student.has_full_access === false
        ? null
        : dailyDepartureLabelForStudent(student);
    const homeway = departure && departure !== "–" ? departure : null;
    const badge = (
      <StatusBadge
        label={status.value}
        tone={CHILD_DAY_TONE_BADGE[status.tone]}
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
        // iPad: Der Status steht direkt hinter dem Namen statt am rechten
        // Rand der breiten Zeile (kurzer Blickweg).
        title={
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">{studentName(student)}</span>
            <span className="phone:hidden shrink-0">{badge}</span>
          </span>
        }
        subtitle={subtitle || undefined}
        // iPad: rechts der Heimweg statt einer leeren halben Zeile.
        meta={
          <>
            <span className="tablet:hidden">{badge}</span>
            {homeway ? (
              <span className="phone:hidden split:hidden">{homeway}</span>
            ) : null}
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
      <div ref={listRef}>
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
