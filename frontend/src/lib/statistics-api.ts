// Statistik (#2606): client for GET /api/statistics/report and its export.
// The Go backend enforces config:read + users:read, validates the window and
// writes the audit row.
import { bffFile, bffJson } from "./bff-fetch";
import type * as statisticsContract from "./contract/statistics.generated";

type WithLists<T, K extends keyof T> = Omit<T, K> & {
  [P in K]: NonNullable<T[P]>;
};

/** Ein Wochentag der Belegung nach Uhrzeit (#4764), Go schickt `slots` als null. */
export type StatisticsOccupancyWeekday = WithLists<
  statisticsContract.occupancyWeekdayResponse,
  "slots"
>;

/** Belegung nach Uhrzeit, die Listen als leere Liste statt null. */
export type StatisticsOccupancy = Omit<
  statisticsContract.occupancyResponse,
  "weekdays"
> & { weekdays: StatisticsOccupancyWeekday[] };

type ReportLists =
  "students" | "groups" | "rooms" | "courses" | "course_students";

/**
 * Der Bericht, die Listen als leere Liste statt null; `occupancy` nur, wenn
 * der Abschnitt "occupancy" angefragt wurde.
 */
export type StatisticsReport = Omit<
  WithLists<statisticsContract.reportResponse, ReportLists>,
  "occupancy"
> & { occupancy?: StatisticsOccupancy };

/** Abschnitte, die der Bericht berechnen soll; leer = alle. */
export type StatisticsReportSection =
  "attendance" | "rooms" | "courses" | "occupancy";

export interface StatisticsFilter {
  groupIds?: readonly string[];
  schoolClasses?: readonly string[];
}

export type StatisticsExportFormat = "pdf" | "xlsx" | "docx";
/**
 * attendance = children and groups (default), rooms = room utilization,
 * courses / course-students = the two views of the course participation
 * section. Each is its own document with its own columns.
 */
export type StatisticsExportSection =
  "attendance" | "rooms" | "courses" | "course-students" | "occupancy";

/** Dateiname-Stamm je Bereich, falls der Server keinen Namen mitschickt. */
export const EXPORT_FILENAME_STEM: Record<StatisticsExportSection, string> = {
  attendance: "statistik",
  rooms: "raumauslastung",
  courses: "kurse",
  "course-students": "kurse-je-kind",
  occupancy: "belegung-nach-uhrzeit",
};

function filterQuery(fromISO: string, toISO: string, filter: StatisticsFilter) {
  return {
    from: fromISO,
    to: toISO,
    group_id: filter.groupIds ?? [],
    school_class: filter.schoolClasses ?? [],
  };
}

function occupancyWithLists(
  occupancy: statisticsContract.occupancyResponse,
): StatisticsOccupancy {
  return {
    ...occupancy,
    weekdays: (occupancy.weekdays ?? []).map((weekday) => ({
      ...weekday,
      slots: weekday.slots ?? [],
    })),
  };
}

export async function fetchStatisticsReport(
  fromISO: string,
  toISO: string,
  filter: StatisticsFilter = {},
  sections: readonly StatisticsReportSection[] = [],
): Promise<StatisticsReport> {
  const report = await bffJson("tenant", "GET /api/statistics/report", {
    query: { ...filterQuery(fromISO, toISO, filter), section: sections },
    errorMessage: "statistics request failed",
  });
  const { occupancy, ...rest } = report;
  return {
    ...rest,
    students: report.students ?? [],
    groups: report.groups ?? [],
    rooms: report.rooms ?? [],
    courses: report.courses ?? [],
    course_students: report.course_students ?? [],
    ...(occupancy && { occupancy: occupancyWithLists(occupancy) }),
  };
}

/**
 * The export file of one section; the caller reads its body and its
 * `Content-Disposition`.
 */
export function fetchStatisticsExport(
  fromISO: string,
  toISO: string,
  format: StatisticsExportFormat,
  filter: StatisticsFilter = {},
  section: StatisticsExportSection = "attendance",
): Promise<Response> {
  return bffFile("tenant", "GET /api/statistics/export", {
    query: {
      ...filterQuery(fromISO, toISO, filter),
      format,
      section: [section],
    },
    errorMessage: "statistics export failed",
  });
}

/** Renders a percent value the way the tables show it ("87,5 %"). */
export function formatRate(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return `${value.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}

/** Minutes → hours with one decimal ("12,5"). */
export function formatHours(minutes: number): string {
  return (minutes / 60).toLocaleString("de-DE", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}
