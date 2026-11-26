import { foldForSearch } from "~/lib/search-fold";
import { fetchStudents, type StudentFilters } from "~/lib/student-api";
import type { Student } from "~/lib/student-helpers";
import { createLogger } from "~/lib/logger";

const logger = createLogger({ component: "StudentSearch" });

/** UI selections shared by the reader and the server seed. */
export interface StudentSearchFilterInput {
  search: string;
  groupIds: readonly string[];
  schoolClasses: readonly string[];
  years: readonly string[];
  roomId: string;
  dayStatus: "all" | NonNullable<StudentFilters["dayStatus"]>;
  date: string;
  isToday: boolean;
  bus: "all" | NonNullable<StudentFilters["bus"]>;
  photoConsent: "all" | NonNullable<StudentFilters["photoConsent"]>;
  pickupStatus: "all" | NonNullable<StudentFilters["pickupStatus"]>;
  companions: boolean;
  /** "<question key>=<answer value>" of the registration form (#6954); "" = off. */
  enrollmentAnswer?: string;
}

/** The search filters, identical for the browser and server reads. */
export function buildStudentSearchFilters(
  params: StudentSearchFilterInput,
): StudentFilters {
  return {
    search: params.search,
    groupId: [...params.groupIds],
    schoolClass: [...params.schoolClasses],
    gradeLevel: [...params.years],
    roomId: params.roomId || undefined,
    dayStatus: params.dayStatus === "all" ? undefined : params.dayStatus,
    date: params.isToday ? undefined : params.date,
    bus: params.bus === "all" ? undefined : params.bus,
    photoConsent:
      params.photoConsent === "all" ? undefined : params.photoConsent,
    pickupStatus:
      params.pickupStatus === "all" ? undefined : params.pickupStatus,
    includePickupTimes: true,
    includeArrivalTimes: true,
    includeCompanions: params.companions,
    view: "slim",
    ...(params.enrollmentAnswer
      ? { enrollmentAnswer: params.enrollmentAnswer }
      : {}),
  };
}

const MAX_STUDENT_SEARCH_PAGES = 20;

/** Same bounded page walk on the server and in the browser. */
export async function fetchStudentSearch(
  filters: StudentFilters,
  requestDate: string,
  requestIsToday: boolean,
  {
    fetchPage = fetchStudents,
    deferOverflowPages = false,
  }: { fetchPage?: typeof fetchStudents; deferOverflowPages?: boolean } = {},
) {
  const result = await fetchPage(filters);
  const students = [...result.students];

  // Walk the remaining pages when the selection is larger than one page.
  // The first request stays untouched (no page parameter), so the common
  // single-page case is byte-identical with before.
  //
  // Separate requests only add up to the whole selection because the list
  // query carries a total order (repositories/users/student.go orders by id
  // unless a caller asks for something else). Without one, PostgreSQL may
  // answer two windows out of two different row orders, and children then
  // appear twice or not at all (#2218 review).
  const totalPages = result.pagination?.total_pages ?? 1;
  const exceedsPageCap = totalPages > MAX_STUDENT_SEARCH_PAGES;
  const pagesDeferred = deferOverflowPages && exceedsPageCap;
  const lastPage = pagesDeferred
    ? 1
    : Math.min(totalPages, MAX_STUDENT_SEARCH_PAGES);
  for (let page = 2; page <= lastPage; page++) {
    const nextPage = await fetchPage({ ...filters, page });
    students.push(...nextPage.students);
  }
  // Past the bound the list is incomplete, and everything downstream — the
  // count badge, the grouping headers, the export scope — reads exactly the
  // rows loaded here. Reporting that as a finished result would present a
  // truncated list as the complete one, so the number the backend counted
  // travels along and the page says on screen that it is showing a part
  // (#2218 review). The log line stays for the server-side view.
  const truncatedTotal = exceedsPageCap
    ? (result.pagination?.total_records ?? students.length)
    : null;
  if (exceedsPageCap && !pagesDeferred) {
    logger.warn("student_search_pages_truncated", {
      total_pages: totalPages,
      fetched_pages: lastPage,
    });
  }

  // Tag the response with its date and today/planning mode. On a rollover,
  // the date can stay the same while the mode flips to live (#1939).
  return {
    students,
    requestDate: requestDate,
    requestIsToday: requestIsToday,
    truncatedTotal,
    ...(pagesDeferred ? { pagesDeferred } : {}),
  };
}

function foldStudentName(value: string): string {
  // Go lowercases uppercase sigma to σ even at the end of a word.
  return foldForSearch(value.replaceAll("Σ", "σ"));
}

/**
 * The name search of the child list, run in the browser on the loaded list so
 * typing asks no server and keeps every child object (and its card) as it is.
 * Same rule as the list endpoint's `matchesSearchFilter`
 * (backend presenceprojection `list_helpers.go`), which the server export of
 * the same term still applies: the folded text is part of „Vorname Nachname“
 * or of the child's ID.
 */
export function studentNameSearch(
  search: string,
): (student: Pick<Student, "id" | "first_name" | "second_name">) => boolean {
  const term = foldStudentName(search);
  if (!term) return () => true;
  return (student) =>
    foldStudentName(
      `${student.first_name ?? ""} ${student.second_name ?? ""}`,
    ).includes(term) || student.id.includes(term);
}
