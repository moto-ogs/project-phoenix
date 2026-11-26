import type { Room } from "~/lib/api";
import {
  LOCATION_STATUSES,
  isAtSchoolLocation,
  isInClassLocation,
  isNotCheckedInLocation,
  isSchoolyardLocation,
  isTransitLocation,
  parseLocation,
} from "~/lib/location-helper";
import { countedDayStatus, dayStatusLabel } from "~/lib/presence-status";
import type { Student } from "~/lib/student-helpers";
import {
  getStudentDayTimes,
  getStudentTimeStatus,
  getTimeStatusSortRank,
} from "~/lib/student-time-status";
import { dailyDepartureLabelForStudent } from "~/components/students/search-student-card";
import type { GroupMode } from "./search-filter-options";

const STATUS_GROUP_ORDER = new Map([
  ["Anwesend", 0],
  ["Unterwegs", 1],
  ["Schulhof", 2],
  ["Krank", 3],
  ["Entschuldigt", 4],
  ["Schule", 5],
  ["Im Unterricht", 6],
  ["Zuhause", 7],
]);

export function compareByName(a: Student, b: Student) {
  const lastCmp = (a.second_name ?? "").localeCompare(
    b.second_name ?? "",
    "de",
  );
  if (lastCmp !== 0) return lastCmp;
  return (a.first_name ?? "").localeCompare(b.first_name ?? "", "de");
}

// Ohne offenen Check-in zählt ein Kind als zuhause, wie in der Betriebszahl
// „Zuhause“ der Startseite (#4588): ein Kind ohne bekannten Ort oder mit
// „Kommt heute nicht“ ist nicht in der OGS. Statuszeile, Statusfilter und
// „Gruppieren nach Status“ lesen diese eine Definition.
const HOME_STATUSES: ReadonlySet<string> = new Set([
  LOCATION_STATUSES.HOME,
  LOCATION_STATUSES.UNKNOWN,
  LOCATION_STATUSES.NOT_ARRIVAL,
]);

// Ort vor Status (#6371): Ein eingechecktes Kind steht unter seinem Ort, auch
// mit Krankmeldung, Entschuldigung oder Klassenfahrt. Der Status bleibt als
// Hinweis am Ortsbadge.
export function statusLabelForStudent(student: Student): string {
  const dayStatus = countedDayStatus(student);
  if (dayStatus) return dayStatusLabel(dayStatus);
  if (isSchoolyardLocation(student.current_location)) return "Schulhof";
  if (isTransitLocation(student.current_location)) return "Unterwegs";
  if (isAtSchoolLocation(student.current_location)) return "Schule";
  if (isInClassLocation(student.current_location)) return "Im Unterricht";
  if (HOME_STATUSES.has(parseLocation(student.current_location).status)) {
    return "Zuhause";
  }
  return "Anwesend";
}

function roomLabelForStudent(student: Student): string {
  if (student.has_full_access === false) return "Nicht einsehbar";

  const location = student.current_location?.trim();
  if (isNotCheckedInLocation(location)) return "Kein Raum";
  if (isTransitLocation(location)) return "Unterwegs";
  if (isSchoolyardLocation(location)) return "Schulhof";
  const separatorIndex = location.indexOf("-");
  if (separatorIndex >= 0) {
    const room = location.slice(separatorIndex + 1).trim();
    return room || "Kein Raum";
  }
  if (Object.values(LOCATION_STATUSES).some((status) => status === location)) {
    return "Kein Raum";
  }
  return location;
}

function pickupLabelForStudent(student: Student): string {
  if (student.has_full_access === false) return "Nicht einsehbar";
  return student.pickup_time ? `${student.pickup_time} Uhr` : "Keine Gehzeit";
}

function dailyDepartureGroupLabelForStudent(student: Student): string {
  const label = dailyDepartureLabelForStudent(student);
  return label === "–" ? "Keine Abholregelung" : label;
}

function arrivalLabelForStudent(student: Student): string {
  if (student.has_full_access === false) return "Nicht einsehbar";
  return student.arrival_time
    ? `${student.arrival_time} Uhr`
    : "Keine Ankunftszeit";
}

const NO_COMPANION_GROUP_LABEL = "Ohne Laufgemeinschaft";
/**
 * A child whose links the caller may not see. The backend only resolves the
 * Laufgemeinschaft of full-access children (`collectFullAccessStudentIDs`), so
 * for a restricted child an empty list means "not readable", NOT "walks alone" —
 * since #2329 that only affects guest/guardian callers, whose view stays
 * redacted. Filing them under "Ohne Laufgemeinschaft" would state as fact the
 * one thing this page cannot know.
 */
const UNKNOWN_COMPANION_GROUP_LABEL = "Nicht einsehbar";

/**
 * Resolves the Laufgemeinschaft of every student on the page.
 *
 * The backend stores links as pairs, not groups: a Laufgemeinschaft is the set
 * of children reachable through those links on the shown day. So this walks the
 * links (union-find) and labels each resulting set with its members' names —
 * there is no group name to display, by design.
 *
 * A companion the filter or the pagination kept off the page still takes part
 * in the walk, it just cannot be NAMED (the list never received them — shipping
 * the names here would leak the children the caller filtered away). Two things
 * depend on that: a child whose only companion is hidden must not be presented
 * as walking alone, and a hidden child can be the bridge of an A-B-C group
 * whose visible members A and C would otherwise fall apart. Hidden members are
 * therefore counted into the label instead of being dropped.
 *
 * Each student is mapped to the component's identity (the union-find root) AND
 * its label. Bucketing has to happen on the identity: the label is built from
 * names, and two unrelated Laufgemeinschaften whose visible children happen to
 * be namesakes would otherwise be merged into one displayed group.
 */
interface CompanionGroup {
  /** Stable identity of the connected component — the bucket key. */
  readonly key: string;
  /** Display text; never used to decide what belongs together. */
  readonly label: string;
}

function companionGroupLabels(
  students: Student[],
): Map<string, CompanionGroup> {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root) ?? root;
    return root;
  };
  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  };
  const addNode = (id: string) => {
    if (!parent.has(id)) parent.set(id, id);
  };

  const onPage = new Set(students.map((student) => String(student.id)));
  for (const student of students) addNode(String(student.id));

  for (const student of students) {
    for (const companionId of student.companion_student_ids ?? []) {
      const companion = String(companionId);
      addNode(companion);
      union(String(student.id), companion);
    }
  }

  const members = new Map<string, Student[]>();
  const hiddenCounts = new Map<string, number>();
  for (const student of students) {
    const root = find(String(student.id));
    const bucket = members.get(root);
    if (bucket) bucket.push(student);
    else members.set(root, [student]);
  }
  for (const id of parent.keys()) {
    if (onPage.has(id)) continue;
    const root = find(id);
    hiddenCounts.set(root, (hiddenCounts.get(root) ?? 0) + 1);
  }

  const labels = new Map<string, CompanionGroup>();
  for (const [root, group] of members) {
    const hidden = hiddenCounts.get(root) ?? 0;
    // A set of one with nothing hidden behind it is a child that walks with
    // nobody on this day. With a hidden member it is a real Laufgemeinschaft
    // we can only show in part. The children who walk alone all share one
    // bucket, so that label IS their key; every real group keeps its own root.
    // A lone restricted child is the third case: nothing links to them on this
    // page and their own links were never sent, so "walks alone" is a guess.
    // Being pulled into a real group is still trustworthy — that link came
    // from a full-access child and is readable data.
    const lonely = group.length + hidden < 2;
    const redacted = lonely && group[0]?.has_full_access === false;
    const resolved: CompanionGroup = redacted
      ? {
          key: UNKNOWN_COMPANION_GROUP_LABEL,
          label: UNKNOWN_COMPANION_GROUP_LABEL,
        }
      : lonely
        ? { key: NO_COMPANION_GROUP_LABEL, label: NO_COMPANION_GROUP_LABEL }
        : {
            key: root,
            label: withHiddenMembers(
              group
                .map((student) => student.name)
                .sort((a, b) => a.localeCompare(b, "de"))
                .join(", "),
              hidden,
            ),
          };
    for (const student of group) labels.set(String(student.id), resolved);
  }
  return labels;
}

/**
 * Appends the count of group members that are not on the page, so a partly
 * filtered Laufgemeinschaft reads as incomplete instead of as the whole group.
 * Only the count travels — the names belong to children the caller filtered out.
 */
function withHiddenMembers(names: string, hidden: number): string {
  if (hidden < 1) return names;
  const suffix =
    hidden === 1 ? "1 weiteres Kind" : `${String(hidden)} weitere Kinder`;
  return `${names} (+ ${suffix} nicht angezeigt)`;
}

export function groupStudents(students: Student[], groupMode: GroupMode) {
  if (groupMode === "none") return [];

  // Companion grouping is the one mode whose label depends on the OTHER
  // students on the page, so it is resolved once up front instead of per row.
  const companionLabels =
    groupMode === "companions" ? companionGroupLabels(students) : null;

  // Every mode but the companion one is grouped BY its label; companions are
  // grouped by component identity and only rendered with the label.
  const groups = new Map<string, { label: string; items: Student[] }>();
  for (const student of students) {
    const companionGroup = companionLabels?.get(String(student.id));
    const label = companionLabels
      ? (companionGroup?.label ?? NO_COMPANION_GROUP_LABEL)
      : groupMode === "status"
        ? statusLabelForStudent(student)
        : groupMode === "room"
          ? roomLabelForStudent(student)
          : groupMode === "arrival"
            ? arrivalLabelForStudent(student)
            : groupMode === "pickup"
              ? pickupLabelForStudent(student)
              : dailyDepartureGroupLabelForStudent(student);
    const key = companionLabels
      ? (companionGroup?.key ?? NO_COMPANION_GROUP_LABEL)
      : label;
    const bucket = groups.get(key);
    if (bucket) {
      bucket.items.push(student);
    } else {
      groups.set(key, { label, items: [student] });
    }
  }

  // The key travels with the group: two unrelated Laufgemeinschaften can render
  // the SAME label (namesake children, identical hidden-member count), and a
  // duplicate React key would let one section's rows reconcile into the other.
  return Array.from(groups.entries())
    .map(([key, { label, items }]) => ({
      key,
      label,
      items,
    }))
    .sort((a, b) => {
      if (groupMode === "status") {
        return (
          (STATUS_GROUP_ORDER.get(a.label) ?? 99) -
          (STATUS_GROUP_ORDER.get(b.label) ?? 99)
        );
      }
      if (groupMode === "pickup" || groupMode === "arrival") {
        const rank = (label: string) =>
          label === "Keine Gehzeit" || label === "Keine Ankunftszeit"
            ? "99"
            : label === "Nicht einsehbar"
              ? "zz"
              : label;
        return rank(a.label).localeCompare(rank(b.label), "de");
      }
      if (groupMode === "companions") {
        // Real Laufgemeinschaften first, then the children who walk with
        // nobody, and last the ones this account may not read.
        const rank = (label: string) =>
          label === NO_COMPANION_GROUP_LABEL
            ? 1
            : label === UNKNOWN_COMPANION_GROUP_LABEL
              ? 2
              : 0;
        const rankCmp = rank(a.label) - rank(b.label);
        if (rankCmp !== 0) return rankCmp;
      }
      if (groupMode === "pickup-status") {
        const rank = (label: string) =>
          label === "Geht alleine nach Hause"
            ? 0
            : label === "Wird abgeholt"
              ? 1
              : label === "Nicht einsehbar"
                ? 99
                : label === "Keine Abholregelung"
                  ? 98
                  : 2;
        const rankCmp = rank(a.label) - rank(b.label);
        if (rankCmp !== 0) return rankCmp;
      }
      return a.label.localeCompare(b.label, "de");
    });
}

export function compareByPickupTime(
  a: Student,
  b: Student,
  now: Date,
  isToday: boolean,
) {
  const statusA = getStudentTimeStatus({
    plannedTime: a.pickup_time,
    actualTime: a.actual_pickup_time,
    now,
    kind: "pickup",
    day: getStudentDayTimes(a, { ignoreCurrentAttendance: !isToday }),
    sick: a.sick,
    classTrip: a.class_trip,
    excused: a.excused,
    currentLocation: isToday ? a.current_location : null,
  });
  const statusB = getStudentTimeStatus({
    plannedTime: b.pickup_time,
    actualTime: b.actual_pickup_time,
    now,
    kind: "pickup",
    day: getStudentDayTimes(b, { ignoreCurrentAttendance: !isToday }),
    sick: b.sick,
    classTrip: b.class_trip,
    excused: b.excused,
    currentLocation: isToday ? b.current_location : null,
  });
  const rankA = getTimeStatusSortRank(statusA);
  const rankB = getTimeStatusSortRank(statusB);
  if (rankA !== rankB) return rankA - rankB;

  const timeA = a.pickup_time;
  const timeB = b.pickup_time;
  if (timeA && !timeB) return -1;
  if (!timeA && timeB) return 1;
  if (timeA && timeB) {
    const timeCmp = timeA.localeCompare(timeB);
    if (timeCmp !== 0) return timeCmp;
  }
  return compareByName(a, b);
}

export function orderedRooms(
  rooms: Room[],
  groupRoomNames: string[],
  supervisedRoomNames: string[],
) {
  const priorityNames = new Set(
    [...groupRoomNames, ...supervisedRoomNames].map((name) =>
      name.trim().toLowerCase(),
    ),
  );

  return [...rooms].sort((a, b) => {
    const aPriority = priorityNames.has(a.name.trim().toLowerCase());
    const bPriority = priorityNames.has(b.name.trim().toLowerCase());
    if (aPriority !== bPriority) return aPriority ? -1 : 1;
    return a.name.localeCompare(b.name, "de");
  });
}
