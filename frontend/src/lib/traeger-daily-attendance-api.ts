import { bffFile, bffJson } from "~/lib/bff-fetch";
/**
 * Client of the daily attendance report of the Träger portal (#4717): the
 * Träger's schools in Mecklenburg-Vorpommern with the children present and
 * absent on each day and their length of stay (§ 32 Absatz 1a KiföG M-V).
 * Figures only, never a child. Backend int64 IDs leave as strings.
 */

import {
  downloadTraegerList,
  type TraegerListFile,
  type TraegerListFormat,
  listExportQuery,
} from "./traeger-list-export";
import type * as traegerSchoolsContract from "./contract/traeger-schools.generated";
import { requiredDay } from "./contract/required-day";
import type { TraegerSchool } from "./traeger-api";

/** The longest period of one report, as in the backend: a month. */
export const DAILY_ATTENDANCE_MAX_DAYS = 31;

export interface DailyAttendanceFigures {
  /** Children present; a child that came counts as present only. */
  readonly present: number;
  readonly sick: number;
  readonly excused: number;
  readonly classTrip: number;
  /** Present children without a recorded pickup. */
  readonly withoutPickup: number;
  /** Earliest check-in and latest pickup, ISO instants; `null` without one. */
  readonly firstArrival: string | null;
  readonly lastPickup: string | null;
  /** Length of stay in minutes of the children with a pickup. */
  readonly averageMinutes: number | null;
  readonly longestMinutes: number | null;
}

export interface DailyAttendanceDay extends DailyAttendanceFigures {
  /** `YYYY-MM-DD`. */
  readonly date: string;
}

export interface DailyAttendanceSummary extends DailyAttendanceFigures {
  /** Days a child was present on. */
  readonly daysWithChildren: number;
  /** Present children per such day, one decimal. */
  readonly presentPerDay: number;
}

export interface TraegerSchoolDailyAttendance extends TraegerSchool {
  readonly summary: DailyAttendanceSummary;
  readonly days: readonly DailyAttendanceDay[];
}

export interface TraegerDailyAttendance {
  /** The period, `YYYY-MM-DD`; it ends yesterday at the latest. */
  readonly from: string;
  readonly to: string;
  /** Schools of the Träger in another federal state, left out. */
  readonly otherSchools: number;
  readonly summary: DailyAttendanceSummary;
  /** All schools together per day. */
  readonly days: readonly DailyAttendanceDay[];
  readonly schools: readonly TraegerSchoolDailyAttendance[];
}

export interface DailyAttendancePeriod {
  readonly from: string;
  readonly to: string;
}

function figuresOf(
  figures:
    | traegerSchoolsContract.DailyAttendanceDay
    | traegerSchoolsContract.DailyAttendanceSummary,
): DailyAttendanceFigures {
  return {
    present: figures.present,
    sick: figures.sick,
    excused: figures.excused,
    classTrip: figures.class_trip,
    withoutPickup: figures.without_pickup,
    firstArrival: figures.first_arrival,
    lastPickup: figures.last_pickup,
    averageMinutes: figures.average_minutes,
    longestMinutes: figures.longest_minutes,
  };
}

function summaryOf(
  summary: traegerSchoolsContract.DailyAttendanceSummary,
): DailyAttendanceSummary {
  return {
    ...figuresOf(summary),
    daysWithChildren: summary.days_with_children,
    presentPerDay: summary.present_per_day,
  };
}

function daysOf(
  days: traegerSchoolsContract.DailyAttendanceDay[] | null,
): DailyAttendanceDay[] {
  return (days ?? []).map((day) => ({
    date: requiredDay(day.date, "daily_attendance_day.date"),
    ...figuresOf(day),
  }));
}

/** The report of the Träger's schools in Mecklenburg-Vorpommern. */
export async function fetchTraegerDailyAttendance(
  period: DailyAttendancePeriod,
): Promise<TraegerDailyAttendance> {
  const report = await bffJson("org", "GET /traeger/schools/daily-attendance", {
    query: { from: period.from, to: period.to },
  });
  return {
    from: requiredDay(report.from, "daily_attendance.from"),
    to: requiredDay(report.to, "daily_attendance.to"),
    otherSchools: report.other_schools,
    summary: summaryOf(report.summary),
    days: daysOf(report.days),
    schools: (report.schools ?? []).map((school) => ({
      id: school.id,
      name: school.name,
      slug: school.slug,
      subdomain: school.subdomain,
      city: school.city,
      summary: summaryOf(school.summary),
      days: daysOf(school.days),
    })),
  };
}

/** The CSV file of the period, with the file name the backend chose. */
export function downloadTraegerDailyAttendance(
  period: DailyAttendancePeriod,
  format: TraegerListFormat,
): Promise<TraegerListFile> {
  return downloadTraegerList(
    bffFile("org", "GET /traeger/schools/daily-attendance/export", {
      query: listExportQuery(format, { from: period.from, to: period.to }),
    }),
  );
}
