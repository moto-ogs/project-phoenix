import { deriveCheckinState } from "~/lib/hooks/use-school-checkin-mode";
import { parseLocation } from "~/lib/location-helper";

/**
 * What the buttons of „Mehrere“ can do with the marked children while a
 * target is chosen under „Anmelden in“. „Anmelden“ places only children who
 * are not checked in yet; children who are already present stay where they
 * are. Bringing those into the target is the separate step „Holen“.
 */
export interface CheckinBulkTarget {
  readonly roomName: string;
  /** Marked children who are not checked in yet. */
  readonly absentCount: number;
  /**
   * Marked children who are present outside the target. Undefined when the
   * person may not move present children there: „Holen“ is then not offered.
   */
  readonly pullCount?: number;
}

interface LocatedStudent {
  readonly current_location?: string | null;
}

function isPresent(student: LocatedStudent): boolean {
  return deriveCheckinState(student.current_location) !== "abwesend";
}

function isIn(student: LocatedStudent, roomName: string): boolean {
  const { status, room } = parseLocation(student.current_location);
  return (
    (room ?? status).trim().toLowerCase() === roomName.trim().toLowerCase()
  );
}

/** The marked children „Holen“ sends: present and not in the target yet. */
export function pullCandidates<T extends LocatedStudent>(
  students: readonly T[],
  roomName: string,
): T[] {
  return students.filter(
    (student) => isPresent(student) && !isIn(student, roomName),
  );
}

export function checkinBulkTarget(
  students: readonly LocatedStudent[],
  roomName: string,
  canPullPresent: boolean,
): CheckinBulkTarget {
  return {
    roomName,
    absentCount: students.filter((student) => !isPresent(student)).length,
    pullCount: canPullPresent
      ? pullCandidates(students, roomName).length
      : undefined,
  };
}

/** Why „Anmelden“ is off although children are marked, else `undefined`. */
export function checkInBlockedReason(
  target: CheckinBulkTarget | null | undefined,
  selectedCount: number,
): string | undefined {
  if (!target || selectedCount === 0 || target.absentCount > 0) {
    return undefined;
  }
  return target.pullCount === undefined
    ? `Die ausgewählten Kinder sind schon angemeldet. In ${target.roomName} kommen sie über die Seite des Raums.`
    : `Die ausgewählten Kinder sind schon angemeldet. Mit „Holen“ kommen sie in ${target.roomName}.`;
}

/** What „Holen“ does, for its tooltip. */
export function pullHint(roomName: string): string {
  return `Holt die ausgewählten Kinder, die schon angemeldet sind, sofort in ${roomName}.`;
}

/**
 * „Direkt“ checks a present child out on every tap; with a target chosen the
 * line says where moving it is possible, so nobody checks a child out and in
 * again to get it into the room.
 */
export function directModeHint(target: CheckinBulkTarget | null): string {
  const base = "Jeder Tipp meldet sofort an oder ab.";
  if (!target) return base;
  return target.pullCount === undefined
    ? `${base} Kinder, die schon angemeldet sind, holst du auf der Seite des Raums in ${target.roomName}.`
    : `${base} Kinder, die schon angemeldet sind, holst du über „Mehrere“ in ${target.roomName}.`;
}

/** Why „Holen“ is off, else `undefined`. */
export function pullBlockedReason(
  target: CheckinBulkTarget,
  selectedCount: number,
): string | undefined {
  if (selectedCount === 0) return "Wähle zuerst mindestens ein Kind aus.";
  if ((target.pullCount ?? 0) > 0) return undefined;
  return `Wähle ein Kind aus, das schon angemeldet und noch nicht in ${target.roomName} ist.`;
}
