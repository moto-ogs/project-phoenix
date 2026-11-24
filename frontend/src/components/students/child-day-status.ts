// Ein Wert je Kind für die App-Liste und das Kind-Blatt (#8070): wo das Kind
// heute ist und die eine Zeit, die dazu zählt. Liest nur Felder, die die
// Kindersuche schon lädt.

import type { StatusBadgeTone } from "~/components/ui/status-badge";
import type { Student } from "~/lib/student-helpers";
import { countedDayStatus, dayStatusLabel } from "~/lib/presence-status";
import { getDayPlanningNotComingLabel } from "~/lib/day-planning-helper";
import {
  isAtSchoolLocation,
  isCheckedInLocation,
  isInClassLocation,
  isSchoolyardLocation,
  isTransitLocation,
} from "~/lib/location-helper";

/** Farbe des Statuspunkts. */
export type ChildDayTone = "present" | "absent" | "school" | "home" | "gone";

export interface ChildDayStatus {
  /** Kurzer Wert rechts in der Zeile („Da bis 16:00“, „Krank“). */
  readonly value: string;
  readonly tone: ChildDayTone;
}

type StatusStudent = Pick<
  Student,
  | "current_location"
  | "sick"
  | "excused"
  | "class_trip"
  | "has_full_access"
  | "pickup_time"
  | "arrival_time"
  | "actual_arrival_time"
  | "actual_pickup_time"
  | "day_planning_status"
> &
  Parameters<typeof getDayPlanningNotComingLabel>[0];

export function childDayStatus(
  student: StatusStudent,
  isToday: boolean,
): ChildDayStatus {
  if (!isToday) {
    if (student.day_planning_status === "comes_today") {
      return {
        value: student.arrival_time ? `Kommt ${student.arrival_time}` : "Kommt",
        tone: "present",
      };
    }
    if (student.day_planning_status === undefined) {
      return { value: "Keine Angabe", tone: "home" };
    }
    return { value: "Kommt nicht", tone: "absent" };
  }

  const times = student.has_full_access !== false;
  const location = student.current_location;
  const counted = countedDayStatus(student);
  if (counted && !student.actual_pickup_time) {
    return { value: dayStatusLabel(counted), tone: "absent" };
  }
  if (student.actual_pickup_time && !isCheckedInLocation(location)) {
    return {
      value: times ? `Gegangen ${student.actual_pickup_time}` : "Gegangen",
      tone: "gone",
    };
  }
  if (isSchoolyardLocation(location)) {
    return { value: "Schulhof", tone: "present" };
  }
  if (isTransitLocation(location)) {
    return { value: "Unterwegs", tone: "present" };
  }
  if (isCheckedInLocation(location)) {
    if (times && student.pickup_time) {
      return { value: `Da bis ${student.pickup_time}`, tone: "present" };
    }
    if (times && student.actual_arrival_time) {
      return {
        value: `Da seit ${student.actual_arrival_time}`,
        tone: "present",
      };
    }
    return { value: "Da", tone: "present" };
  }
  if (isInClassLocation(location))
    return { value: "Unterricht", tone: "school" };
  if (isAtSchoolLocation(location)) return { value: "Schule", tone: "school" };
  if (getDayPlanningNotComingLabel(student)) {
    return { value: "Kommt nicht", tone: "absent" };
  }
  if (times && student.arrival_time) {
    return { value: `Kommt ${student.arrival_time}`, tone: "home" };
  }
  return { value: "Zuhause", tone: "home" };
}

/** Ton der Status-Pille rechts in der Zeile. */
export const CHILD_DAY_TONE_BADGE: Record<ChildDayTone, StatusBadgeTone> = {
  present: "green",
  absent: "red",
  school: "cyan",
  home: "gray",
  gone: "outline",
};
