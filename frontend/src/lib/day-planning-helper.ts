import type * as studentsContract from "~/lib/contract/students.generated";
import {
  LOCATION_STATUSES,
  isInClassLocation,
  parseLocation,
} from "./location-helper";

/**
 * The day-planning fields of a student row, from any read that carries
 * them. current_location may be null in rows that have no location yet.
 */
export type DayPlanningStudent = Partial<
  Pick<
    studentsContract.SlimStudentResponse,
    | "day_planning_reason"
    | "day_planning_label"
    | "arrival_is_exception"
    | "arrival_time"
    | "arrival_notes"
    | "actual_arrival_time"
  >
> & {
  // Narrowed to the statuses this build knows.
  day_planning_status?: studentsContract.DayPlanningStatus;
  current_location?: string | null;
};

export function getDayPlanningNotComingLabel(
  student: Pick<
    DayPlanningStudent,
    | "day_planning_status"
    | "day_planning_label"
    | "actual_arrival_time"
    | "current_location"
  >,
  options?: {
    /**
     * Skip the actual-attendance suppression. Set when the planning status was
     * computed for a non-today date (#1939): a child being present right now
     * says nothing about another day, so the "not expected" label must stay.
     */
    ignoreCurrentAttendance?: boolean;
  },
): string | null {
  if (!options?.ignoreCurrentAttendance && hasActualAttendance(student)) {
    return null;
  }
  // Zum Unterricht abgemeldet: das Kind war heute da und ist in der Schule,
  // auch wenn der Tagesplan es wegen einer Krankmeldung nicht erwartet (#5710).
  if (
    !options?.ignoreCurrentAttendance &&
    isInClassLocation(student.current_location)
  ) {
    return null;
  }
  if (student.day_planning_status !== "not_coming_today") return null;
  return student.day_planning_label ?? "kein Plan für heute";
}

export function getStudentPresenceBadgePlanning(student: DayPlanningStudent): {
  notArrivalToday: boolean;
  notArrivalReason: string | null;
} {
  if (
    student.day_planning_reason === "unplanned_attendance" &&
    hasActualAttendance(student)
  ) {
    return {
      notArrivalToday: true,
      notArrivalReason: student.day_planning_label ?? "ungeplant anwesend",
    };
  }

  const dayPlanningLabel = getDayPlanningNotComingLabel(student);
  const arrivalExceptionAbsent =
    (student.arrival_is_exception ?? false) && !student.arrival_time;

  return {
    notArrivalToday: dayPlanningLabel !== null || arrivalExceptionAbsent,
    notArrivalReason: dayPlanningLabel ?? student.arrival_notes ?? null,
  };
}

/** Whether the child is checked in on site right now (room, yard, on the way). */
/**
 * Whether a day exception without a time keeps the child away: it does not
 * come (arrival) or is not picked up (pickup). Actual attendance, also a
 * return to class, wins over the exception (#6487). The child cards use it to
 * leave the day's offerings off (#8194). Another planning day has no
 * attendance yet: pass `ignoreCurrentAttendance`.
 */
export function dayExceptionKeepsAway(
  student: Pick<DayPlanningStudent, "actual_arrival_time" | "current_location">,
  exception: Readonly<{ arrivalAbsent: boolean; pickupAbsent: boolean }>,
  options?: Readonly<{ ignoreCurrentAttendance?: boolean }>,
): boolean {
  if (
    !options?.ignoreCurrentAttendance &&
    (hasActualAttendance(student) ||
      isInClassLocation(student.current_location))
  ) {
    return false;
  }
  return exception.arrivalAbsent || exception.pickupAbsent;
}

export function hasActualAttendance(
  student: Pick<DayPlanningStudent, "actual_arrival_time" | "current_location">,
): boolean {
  if (student.current_location?.trim()) {
    const { status } = parseLocation(student.current_location);
    return (
      status === LOCATION_STATUSES.PRESENT ||
      status === LOCATION_STATUSES.SCHOOLYARD ||
      status === LOCATION_STATUSES.TRANSIT
    );
  }
  return !!student.actual_arrival_time;
}
