/**
 * Client of the daily attendance report of the Träger portal (#4717): the
 * Träger's schools in Mecklenburg-Vorpommern with the children present and
 * absent on each day and their length of stay (§ 32 Absatz 1a KiföG M-V).
 * Figures only, never a child. Backend int64 IDs leave as strings.
 */

import { apiErrorFromBody, transportFetch } from "./api-error";
import {
  downloadTraegerList,
  type TraegerListFile,
  type TraegerListFormat,
} from "./traeger-list-export";
import type {
  DailyAttendance as WireReport,
  DailyAttendanceDay as WireDay,
  DailyAttendanceSummary as WireSummary,
} from "./contract/traeger-schools.generated";
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

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function query(period: DailyAttendancePeriod): string {
  return new URLSearchParams({ from: period.from, to: period.to }).toString();
}

function figuresOf(figures: WireDay | WireSummary): DailyAttendanceFigures {
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

function summaryOf(summary: WireSummary): DailyAttendanceSummary {
  return {
    ...figuresOf(summary),
    daysWithChildren: summary.days_with_children,
    presentPerDay: summary.present_per_day,
  };
}

function daysOf(days: WireDay[] | null): DailyAttendanceDay[] {
  return (days ?? []).map((day) => ({
    date: requiredDay(day.date, "daily_attendance_day.date"),
    ...figuresOf(day),
  }));
}

/** The report of the Träger's schools in Mecklenburg-Vorpommern. */
export async function fetchTraegerDailyAttendance(
  period: DailyAttendancePeriod,
): Promise<TraegerDailyAttendance> {
  const response = await transportFetch(
    `/api/traeger/schools/daily-attendance?${query(period)}`,
    { credentials: "include", cache: "no-store" },
  );
  const data = await readJson(response);
  if (!response.ok) {
    throw apiErrorFromBody(
      `Request failed (${response.status})`,
      response.status,
      data,
    );
  }
  const report = (data as { data: WireReport }).data;
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
    "/api/traeger/schools/daily-attendance/export",
    format,
    { from: period.from, to: period.to },
  );
}
