// Tagesauswertung (#1456): client for GET /api/students/day-log and its
// export. The Go backend enforces the gdpr.attendance_log_enabled gate and
// the group scope.
import { bffFile, bffJson } from "~/lib/bff-fetch";
import type * as studentsContract from "~/lib/contract/students.generated";
import { requiredEnum } from "~/lib/contract/known-enum";
import { LOCATION_COLORS } from "~/lib/location-helper";

const DAY_LOG_STATUSES = [
  "present",
  "sick",
  "class_trip",
  "excused",
  "absent",
  "not_scheduled",
] as const;

export type DayLogStatus = (typeof DAY_LOG_STATUSES)[number];

/**
 * One child of the day; `check_out_note` says why it went home early
 * (#3324), `class_periods` are the times in class between the stays (#5656).
 */
export type DayLogStudent = Omit<studentsContract.dayLogStudent, "status"> & {
  status: DayLogStatus;
};

export type DayLogGroup = Omit<studentsContract.dayLogGroup, "students"> & {
  students: DayLogStudent[];
};

export type DayLogResponse = Omit<studentsContract.dayLogResponse, "groups"> & {
  groups: DayLogGroup[];
};

function dayLogGroup(group: studentsContract.dayLogGroup): DayLogGroup {
  return {
    ...group,
    students: (group.students ?? []).map((student) => ({
      ...student,
      // The status section and its colour need a status this build knows.
      status: requiredEnum(DAY_LOG_STATUSES, student.status, "day log status"),
    })),
  };
}

export async function fetchDayLog(
  dateISO: string,
  groupId?: string,
): Promise<DayLogResponse> {
  // Ausgeschaltet oder ohne sichtbare Gruppe erkennt die Seite am Code
  // (students.day_log_disabled, students.day_log_no_groups), nie am Text.
  const log = await bffJson("tenant", "GET /api/students/day-log", {
    query: { date: dateISO, group_id: groupId },
    errorMessage: "day log request failed",
  });
  return { ...log, groups: (log.groups ?? []).map(dayLogGroup) };
}

export type DayLogExportFormat = "pdf" | "docx" | "xlsx";

/** The export file of the day or one group; the caller reads body and name. */
export function fetchDayLogExport(
  dateISO: string,
  format: DayLogExportFormat,
  groupId?: string,
): Promise<Response> {
  return bffFile("tenant", "GET /api/students/day-log/export", {
    query: { date: dateISO, format, group_id: groupId },
    errorMessage: "day log export failed",
  });
}

/** Display order of the status sections: explained absences in the middle,
 * unexplained "Abwesend" deliberately last (that's the follow-up list). */
export const DAY_LOG_STATUS_ORDER: readonly DayLogStatus[] = [
  "present",
  "sick",
  "class_trip",
  "excused",
  "not_scheduled",
  "absent",
];

export const DAY_LOG_STATUS_COLORS: Record<DayLogStatus, string> = {
  present: LOCATION_COLORS.GROUP_ROOM,
  sick: LOCATION_COLORS.SICK,
  class_trip: LOCATION_COLORS.CLASS_TRIP,
  excused: LOCATION_COLORS.EXCUSED,
  not_scheduled: LOCATION_COLORS.UNKNOWN,
  // Every status in this map drives a StatusColorBadge in the same list, so all
  // six hues have to differ. HOME is grey and would clash with not_scheduled;
  // DANGER is the same red as sick. Amber carries the meaning anyway: an
  // unexplained absence is the one row that needs following up.
  absent: LOCATION_COLORS.WARNING,
};

/** Sources that came from the parents portal get a short origin hint. */
export function dayLogSourceLabel(source?: string): string {
  switch (source) {
    case "parent":
      return "Eltern-App";
    case "care_plan_cancelled":
      return "Abmeldung im Betreuungsplan";
    default:
      return "";
  }
}
