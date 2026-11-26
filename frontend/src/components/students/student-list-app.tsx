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

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  CalendarX,
  Clock,
  Route,
  StickyNote,
} from "lucide-react";

import { PresenceHint } from "~/components/students/presence/presence-hint";
import { resolvePresence } from "~/lib/presence-status";

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
import {
  SearchStudentStatusBadge,
  searchStudentDay,
} from "~/components/students/search-student-card";
import { dayHomeChange } from "~/components/students/student-table";
import { NotificationBadge } from "~/components/ui/notification-badge";
import { COUNTER_TONE } from "~/lib/counter-tones";
import { useStudentParentAttention } from "~/lib/hooks/use-parent-attention";
import { cn } from "~/lib/utils";
import { MOTO_COLOR_PALETTE } from "~/lib/kit-palette";
import type { TrackingIndicatorsResponse } from "~/lib/active-helpers";
import { useRowClock } from "~/components/students/student-card-clock";
import { useDeviceContext } from "~/lib/device-context";
import { getAccessibleTextColor } from "~/lib/kit-palette";
import { getDayPlanningNotComingLabel } from "~/lib/day-planning-helper";
import type { DepartureMode } from "~/lib/departure-plan";
import type { Student } from "~/lib/student-helpers";
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

// Nur für die Hinweiszeile: Der Hinweis hängt nicht am Ortsmodus.
const BINARY_VIEW = { mode: "binary" } as const;

function shortDepartureLabel(student: Student): string | null {
  if (student.has_full_access === false) return null;
  const legacy = student.departure_label?.trim();
  if (legacy) return legacy;
  const modes = student.departure_modes ?? [];
  if (modes.length === 0) return null;
  return modes.map((mode) => SHORT_DEPARTURE_LABELS[mode]).join(", ");
}

/**
 * Zweite Zeile (#8070): vorn, was heute auf der Karte rot steht (eine
 * überschrittene Ankunfts- oder Gehzeit) oder ein Hinweis der Lehrkraft,
 * dahinter Klasse, Gruppe und Heimweg. Jede Zeile bleibt zweizeilig, damit
 * die Liste auch nachmittags mit vielen Warnungen dicht bleibt; den ganzen
 * Hinweis zeigt das Kind-Blatt.
 */
function RowLine({
  student,
  isToday,
  klass,
  homeway,
}: Readonly<{
  student: Student;
  isToday: boolean;
  klass: string | undefined;
  homeway: string | null;
}>) {
  // Die Klasse bleibt ganz; Gruppe und Heimweg kürzen sich mit „…“, statt
  // am kleinen Telefon still wegzufallen. Neben einem Hinweis vorn steht der
  // Heimweg auf keinem Telefon (er steht im Kind-Blatt), damit iPhone SE und
  // iPhone 15 dieselben Angaben zeigen.
  let parts: { text: string; kind: "class" | "group" | "homeway" }[] = [
    klass ? { text: klass, kind: "class" as const } : null,
    student.group_name
      ? { text: student.group_name, kind: "group" as const }
      : null,
    homeway ? { text: homeway, kind: "homeway" as const } : null,
  ].filter((part) => part !== null);
  const now = useRowClock(undefined);
  const dayChange =
    isToday && student.has_full_access !== false
      ? dayHomeChange(searchStudentDay(student, isToday))
      : undefined;
  let lead: ReactNode = null;
  // „für heute“ sagt schon die Pille („Kommt heute nicht“); ohne die Doppelung
  // bleiben Klasse und Gruppe auch am iPhone SE daneben stehen.
  const notComing = isToday
    ? (getDayPlanningNotComingLabel(student)?.replace(/ für heute$/, "") ??
      null)
    : null;
  // Neben einer Warnung folgen Klasse, Gruppe und Heimweg wie sonst; was
  // nicht mehr passt, steht ganz im Kind-Blatt.
  if (student.has_full_access !== false) {
    const overdue = isToday ? overdueTime(student, now) : null;
    if (overdue) {
      lead = (
        <span
          className="flex shrink-0 items-center gap-1 font-medium"
          style={{ color: overdue.color }}
        >
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
          {overdue.label} {overdue.time}, überfällig
        </span>
      );
    } else if (dayChange) {
      // Wie der orange Streifen der Karte (#3946): heute anders als sonst.
      const time = dayChange.time ? (student.pickup_time ?? null) : null;
      const mode = dayChange.mode
        ? SHORT_DEPARTURE_LABELS[dayChange.mode]
        : null;
      lead = (
        <span
          className="flex shrink-0 items-center gap-1 font-medium"
          style={{ color: MOTO_COLOR_PALETTE.orange.strong }}
        >
          {dayChange.mode ? (
            <Route className="size-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <Clock className="size-3.5 shrink-0" aria-hidden="true" />
          )}
          Heute{" "}
          {[mode, time ? `geht ${time}` : null].filter(Boolean).join(", ")}
        </span>
      );
      // Der geänderte Heimweg steht schon vorn.
      if (dayChange.mode)
        parts = parts.filter((part) => part.kind !== "homeway");
    } else if (notComing) {
      // Wie „Kommt heute nicht (kein Plan für heute)“ auf der Karte: Die
      // Pille nennt den Zustand, die zweite Zeile den Grund.
      lead = (
        <span className="flex shrink-0 items-center gap-1 font-medium text-gray-700">
          <CalendarX className="size-3.5 shrink-0" aria-hidden="true" />
          {notComing.charAt(0).toUpperCase() + notComing.slice(1)}
        </span>
      );
    } else if (student.teacher_hints?.length) {
      lead = (
        <span className="flex shrink-0 items-center gap-1 font-medium text-gray-700">
          <StickyNote className="size-3.5 shrink-0" aria-hidden="true" />
          Hinweis
        </span>
      );
    }
  }
  // Die Zeile unter der Pille der Karte („Ungeplant anwesend“, „Krank“)
  // steht hier vorn in der zweiten Zeile: in der Namenszeile kürzte sie den
  // Namen („Ben Hartm…“). Nur heute, wie die Pille selbst.
  const hint = isToday ? resolvePresence(student, BINARY_VIEW).hint : null;
  const hintNode = hint ? (
    <span className="flex shrink-0 [&>span]:mt-0 [&>span]:text-sm">
      <PresenceHint status={hint.status} title={hint.title} />
    </span>
  ) : null;
  const leading = Boolean(lead || hintNode);
  if (leading) parts = parts.filter((part) => part.kind !== "homeway");
  if (!leading && parts.length === 0) return null;
  // Eine Zeile hoch: Was nicht mehr in die Zeile passt, bricht in eine
  // verborgene Folgezeile um.
  return (
    <span className="flex h-[1lh] min-w-0 flex-wrap items-center gap-x-1 overflow-hidden">
      {hintNode}
      {hintNode && lead ? <span aria-hidden="true">·</span> : null}
      {lead}
      {parts.map((part, index) => (
        <span
          key={part.kind}
          // Gruppe und Heimweg kürzen sich mit „…“ („· Regenbogengr…“). Die
          // Gruppe bekommt den Platz zuerst: Erst wenn sie ganz steht, wächst
          // der Heimweg in den Rest.
          className={cn(
            part.kind === "class"
              ? "shrink-0 whitespace-nowrap"
              : "max-w-max min-w-0 shrink truncate",
            part.kind === "group" && "grow-[1000] basis-12",
            part.kind === "homeway" && "grow basis-16",
          )}
        >
          {leading || index > 0 ? "· " : ""}
          {part.text}
        </span>
      ))}
    </span>
  );
}

/**
 * Neue Nachrichten und offene Anfragen der Eltern als Zahl am Namen, wie an
 * der Ecke der Kinderkarte (#6486). In der Zeile nur Anzeige: Ein Tipp
 * öffnet das Kind-Blatt, dort steht der Knopf zu den Nachrichten.
 */
function RowParentAttention({ studentId }: Readonly<{ studentId: string }>) {
  const attention = useStudentParentAttention(studentId);
  if (!attention) return null;
  return (
    <NotificationBadge
      count={attention.total}
      tone={COUNTER_TONE.parents}
      size="sm"
      ariaLabel={`${attention.total} neu von den Eltern`}
      className="shrink-0"
    />
  );
}

/** Die überschrittene Ankunfts- oder Gehzeit eines Kindes, wie auf der Karte. */
function overdueTime(student: Student, now: Date) {
  const day = getStudentDayTimes(student);
  const absence = {
    sick: student.sick,
    classTrip: student.class_trip,
    excused: student.excused,
    currentLocation: student.current_location,
  };
  const candidates = [
    // „Kommt 12:30“ wie im Kind-Blatt („Kommt 12:30, überfällig“); Rot und
    // Warnzeichen sagen, dass die Zeit überschritten ist. Kürzer als
    // „Ankunftszeit 12:30“: Klasse und Gruppe bleiben auch am iPhone SE stehen.
    {
      label: "Kommt",
      kind: "arrival",
      plannedTime: student.arrival_time,
      actualTime: student.actual_arrival_time,
    },
    {
      label: "Geht",
      kind: "pickup",
      plannedTime: student.pickup_time ?? undefined,
      actualTime: student.actual_pickup_time,
    },
  ] as const;
  for (const { label, kind, plannedTime, actualTime } of candidates) {
    const status = getStudentTimeStatus({
      plannedTime,
      actualTime,
      now,
      kind,
      day,
      ...absence,
    });
    const late =
      status.state === "very-overdue" || status.state === "slightly-overdue";
    if (late && status.textColor && status.displayTime) {
      return {
        label,
        kind,
        time: status.displayTime,
        color: getAccessibleTextColor(status.textColor),
      };
    }
  }
  return null;
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

// Kleine Telefone (iPhone SE, Höhe unter 700 px): Zeilen 44 statt 59 px und
// Buchstabenköpfe 18 statt 36 px, damit bis über der Aktionsleiste acht
// Kinder ganz zu sehen sind (129 + 2 × 18 + 8 × 44 = 517 px, Leiste ab
// 521 px). Alle Angaben bleiben, nur Innenabstand und Zeilenhöhe der zweiten
// Zeile schrumpfen; die Zeile bleibt 44 px hoch und damit 44 px Ziel.
const SHORT_PHONE_DENSE = [
  "phone:[@media(max-height:700px)]:[&_[data-collection-row]]:min-h-11",
  "phone:[@media(max-height:700px)]:[&_[data-collection-row]]:py-[3px]",
  "phone:[@media(max-height:700px)]:[&_[data-row-target]+span]:mt-0",
  "phone:[@media(max-height:700px)]:[&_[data-row-target]+span]:leading-[1.0625rem]",
  "phone:[@media(max-height:700px)]:[&_[data-collection-group]>div:first-child]:h-6",
  "phone:[@media(max-height:700px)]:[&_[data-collection-group]>div:first-child]:min-h-0",
  "phone:[@media(max-height:700px)]:[&_[data-collection-group]>div:first-child]:py-0",
  "phone:[@media(max-height:700px)]:[&_[data-collection-group]_h3]:leading-[1.0625rem]",
].join(" ");

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
  trackingData,
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
  /** Merkpunkte der Schule, wie auf der Karte; das Blatt zeigt sie. */
  trackingData?: TrackingIndicatorsResponse;
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
            <RowParentAttention studentId={id} />
            <span className="ml-auto shrink-0">{badge}</span>
          </span>
        }
        subtitle={
          <RowLine
            student={student}
            isToday={isToday}
            klass={klass}
            homeway={homeway}
          />
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
    <Collection label="Kinder" className={`phone:-mt-1.5 ${SHORT_PHONE_DENSE}`}>
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
      // Die Leiste steht innen am rechten Kartenrand und erscheint nur beim
      // Rollen; in Ruhe haben die Zeilen rechts denselben Rand wie links.
      <div ref={listRef}>
        {list}
        <IndexRail letters={railLetters} onJump={scrollToLetter} />
      </div>
    ) : (
      list
    );

  const selectedStudent = selected ? (byId.get(selected) ?? null) : null;
  const sheetStudent = sheetId ? (byId.get(sheetId) ?? null) : null;
  // Alles, was die Karte am Desktop zeigt, steht im Blatt (#8070).
  const cardFactsOf = (student: Student) => ({
    tracking: trackingData?.labels?.length
      ? {
          labels: trackingData.labels,
          results: trackingData.results[student.id] ?? [],
        }
      : undefined,
  });

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
                cardFacts={cardFactsOf(selectedStudent)}
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
        cardFacts={sheetStudent ? cardFactsOf(sheetStudent) : undefined}
        // Oben dieselbe Orts-Pille wie in der Zeile („Zuhause“, Raum) samt
        // Hinweis; die Ankunft steht nur einmal, unter „Ankunft heute“.
        statusBadge={
          sheetStudent ? (
            <div className="flex [&_.mt-1]:mt-0 [&>div]:flex-row [&>div]:items-center [&>div]:gap-2">
              <SearchStudentStatusBadge
                student={sheetStudent}
                isToday={isToday}
                userGroups={userGroups}
                groupRooms={groupRooms}
                supervisedRooms={supervisedRooms}
              />
            </div>
          ) : undefined
        }
      />
    </>
  );
}
