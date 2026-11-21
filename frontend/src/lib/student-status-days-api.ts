import {
  ApiError,
  apiErrorFromBody,
  apiErrorFromResponse,
} from "~/lib/api-error";
import { bffJson } from "~/lib/bff-fetch";
import type { ErrorCode } from "~/lib/error-codes.generated";
import { sessionFetch } from "~/lib/session-cache";
import { knownEnum } from "~/lib/contract/known-enum";
import type {
  BulkCreateStudentStatusDaysRequest,
  CreateStudentStatusDaysRequest,
  StatusDaysBulkCreatedResponse,
  StudentStatusDayResponse,
  statusDayOverviewResponse,
} from "~/lib/contract/students.generated";

export type StudentStatusKind = "sick" | "excused" | "class_trip";

const STATUS_KINDS: readonly StudentStatusKind[] = [
  "sick",
  "excused",
  "class_trip",
];

export interface StudentStatusDay {
  id: string;
  student_id: string;
  date: string;
  status: StudentStatusKind;
  label: string;
  reported_at: string;
  cleared_at?: string | null;
  source: string;
  /** Optional free-text reason, e.g. a parent-supplied sick note. */
  note?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * One existing day in the 409 body of a status-day write. Error bodies do not
 * pass the response decoder, so its IDs may still be JSON numbers.
 */
interface ConflictStatusDay extends Omit<
  StudentStatusDayResponse,
  "id" | "student_id"
> {
  id: number | string;
  student_id: number | string;
}

/** The 409 body of a status-day write that would overwrite existing days. */
interface ConflictBody {
  conflicts?: ConflictStatusDay[];
  /** Full conflict count when `conflicts` is a capped sample. */
  conflict_count?: number;
  code?: string;
  instance?: string;
}

/** Matches backend `students.partial_absence_conflict` on status-day writes. */
const PARTIAL_ABSENCE_CONFLICT_CODE: ErrorCode =
  "students.partial_absence_conflict";

/** null: a status this build does not know; lists leave the day out. */
function mapStatusDay(
  row: StudentStatusDayResponse | ConflictStatusDay,
): StudentStatusDay | null {
  const status = knownEnum(STATUS_KINDS, row.status);
  if (!status) return null;
  return {
    ...row,
    id: String(row.id),
    student_id: String(row.student_id),
    status,
  };
}

function mapStatusDays(
  rows: readonly (StudentStatusDayResponse | ConflictStatusDay)[],
): StudentStatusDay[] {
  return rows.flatMap((row) => {
    const day = mapStatusDay(row);
    return day ? [day] : [];
  });
}

export class StudentStatusDayConflictError extends ApiError {
  readonly conflicts: StudentStatusDay[];
  /** Full conflict count; may exceed `conflicts.length` when the API capped samples. */
  readonly totalCount: number;

  constructor(
    conflicts: StudentStatusDay[],
    totalCount?: number,
    payload?: { code?: string; instance?: string },
  ) {
    super("Vorhandene Status-Tage wurden nicht überschrieben", 409, payload);
    this.name = "StudentStatusDayConflictError";
    this.conflicts = conflicts;
    this.totalCount = totalCount ?? conflicts.length;
  }
}

function parseConflictError(result: ConflictBody): Error {
  // Only a body naming the existing days is the overwrite question. Any
  // other 409 (a partial absence, the Kinderkontingent) keeps its own code,
  // so the person reads its real reason.
  if (
    result.code === PARTIAL_ABSENCE_CONFLICT_CODE ||
    (!Array.isArray(result.conflicts) &&
      typeof result.conflict_count !== "number")
  ) {
    return apiErrorFromBody("status day write refused", 409, result);
  }
  const conflicts = mapStatusDays(result.conflicts ?? []);
  const totalCount =
    typeof result.conflict_count === "number" &&
    Number.isFinite(result.conflict_count)
      ? result.conflict_count
      : conflicts.length;
  return new StudentStatusDayConflictError(conflicts, totalCount, {
    code: result.code,
    instance: result.instance,
  });
}

/**
 * A status-day write. Its 409 is a question with the conflicting days in the
 * body (or the partial-absence refusal), not a plain failure.
 */
async function writeStatusDays<T>(
  url: string,
  body: unknown,
  fallback: string,
): Promise<T> {
  const response = await sessionFetch(url, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (response.status === 409) {
    throw parseConflictError((await response.json()) as ConflictBody);
  }
  if (!response.ok) throw await apiErrorFromResponse(response, fallback);
  return ((await response.json()) as { data: T }).data;
}

export async function fetchStudentStatusDays(
  studentId: string,
  from: string,
  to: string,
): Promise<StudentStatusDay[]> {
  const rows = await bffJson<StudentStatusDayResponse[]>(
    `/api/students/${encodeURIComponent(studentId)}/status-days?from=${from}&to=${to}`,
  );
  return mapStatusDays(rows);
}

/** One row of the tenant-wide absence overview (#2288). */
export interface StatusDayOverviewEntry {
  id: string;
  student_id: string;
  first_name: string;
  last_name: string;
  school_class: string;
  group_id: string;
  group_name: string;
  date: string;
  status: StudentStatusKind;
  label: string;
  reported_at: string;
  source: string;
}

export interface StatusDayOverview {
  from: string;
  to: string;
  groups: Array<{ id: string; name: string }>;
  entries: StatusDayOverviewEntry[];
  page: number;
  page_size: number;
  has_more: boolean;
}

export async function fetchStatusDayOverview(
  from: string,
  to: string,
  filters: { page: number; query: string; status: string; groupId: string },
): Promise<StatusDayOverview> {
  const params = new URLSearchParams({
    from,
    to,
    page: filters.page.toString(),
    page_size: "50",
  });
  if (filters.query.trim()) params.set("q", filters.query.trim());
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.groupId !== "all") params.set("group_id", filters.groupId);
  const overview = await bffJson<statusDayOverviewResponse>(
    `/api/students/status-days?${params}`,
  );
  return {
    ...overview,
    groups: overview.groups ?? [],
    // A status this build does not know leaves its row out.
    entries: (overview.entries ?? []).flatMap((entry) => {
      const status = knownEnum(STATUS_KINDS, entry.status);
      return status ? [{ ...entry, status }] : [];
    }),
  };
}

export async function createStudentStatusDays(
  studentId: string,
  status: StudentStatusKind,
  dates: string[],
  reason?: string,
  /** Days whose partial excusal the person chose to replace (#5698). */
  replacePartialAbsenceDates?: readonly string[],
): Promise<StudentStatusDay[]> {
  const body: CreateStudentStatusDaysRequest = {
    status,
    dates,
    ...(reason ? { reason } : {}),
    ...(replacePartialAbsenceDates?.length
      ? { replace_partial_absence_dates: [...replacePartialAbsenceDates] }
      : {}),
  };
  const rows = await writeStatusDays<StudentStatusDayResponse[]>(
    `/api/students/${encodeURIComponent(studentId)}/status-days`,
    body,
    "Geplante Einträge konnten nicht gespeichert werden",
  );
  return mapStatusDays(rows);
}

export async function bulkCreateStudentStatusDays(
  studentIds: string[],
  status: StudentStatusKind,
  from: string,
  to: string,
  reason?: string,
): Promise<StatusDaysBulkCreatedResponse> {
  const student_ids = [...studentIds];
  const body: BulkCreateStudentStatusDaysRequest = reason
    ? { student_ids, status, from, to, reason }
    : { student_ids, status, from, to };
  return writeStatusDays<StatusDaysBulkCreatedResponse>(
    "/api/students/status-days/bulk",
    body,
    "Klassenfahrt konnte nicht gespeichert werden",
  );
}

export async function deleteStudentStatusDay(
  studentId: string,
  statusDayId: string,
): Promise<void> {
  await bffJson<unknown>(
    `/api/students/${encodeURIComponent(studentId)}/status-days/${encodeURIComponent(statusDayId)}`,
    { method: "DELETE" },
  );
}
