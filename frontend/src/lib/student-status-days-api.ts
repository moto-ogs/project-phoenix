import { ApiError } from "~/lib/api-error";
import { bffJson } from "~/lib/bff-fetch";
import { knownEnum } from "~/lib/contract/known-enum";
import { problemDetails } from "~/lib/contract/problem-details.generated";
import type {
  BulkCreateStudentStatusDaysRequest,
  CreateStudentStatusDaysRequest,
  StatusDaysBulkCreatedResponse,
  StudentStatusDayResponse,
  statusDayOverviewEntry,
  statusDayOverviewGroup,
  statusDayOverviewResponse,
} from "~/lib/contract/students.generated";

export type StudentStatusKind = "sick" | "excused" | "class_trip";

const STATUS_KINDS: readonly StudentStatusKind[] = [
  "sick",
  "excused",
  "class_trip",
];

/** A status day whose status this build knows. */
export type StudentStatusDay = Omit<StudentStatusDayResponse, "status"> & {
  status: StudentStatusKind;
};

/** null: a status this build does not know; lists leave the day out. */
function mapStatusDay(row: StudentStatusDayResponse): StudentStatusDay | null {
  const status = knownEnum(STATUS_KINDS, row.status);
  return status ? { ...row, status } : null;
}

function mapStatusDays(
  rows: readonly StudentStatusDayResponse[],
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

function parseConflictError(error: ApiError): ApiError {
  // Only a body naming the existing days is the overwrite question. Any
  // other 409 (a partial absence, the Kinderkontingent) keeps its own code,
  // so the person reads its real reason.
  if (error.code !== "students.status_day_conflict") return error;
  const result = problemDetails["students.status_day_conflict"].safeParse(
    error.details,
  );
  if (!result.success) return error;
  const conflicts = mapStatusDays(result.data.conflicts ?? []);
  return new StudentStatusDayConflictError(
    conflicts,
    result.data.conflict_count,
    {
      code: error.code,
      instance: error.requestId,
    },
  );
}

/**
 * A status-day write. Its 409 is a question with the conflicting days in the
 * body (or the partial-absence refusal), not a plain failure.
 */
async function writeStatusDays<T>(write: Promise<T>): Promise<T> {
  try {
    return await write;
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      throw parseConflictError(error);
    }
    throw error;
  }
}

export async function fetchStudentStatusDays(
  studentId: string,
  from: string,
  to: string,
): Promise<StudentStatusDay[]> {
  const rows = await bffJson("tenant", "GET /api/students/{id}/status-days", {
    params: { id: studentId },
    query: { from, to },
  });
  return mapStatusDays(rows);
}

/** One row of the tenant-wide absence overview (#2288). */
export type StatusDayOverviewEntry = Omit<statusDayOverviewEntry, "status"> & {
  status: StudentStatusKind;
};

export type StatusDayOverview = Omit<
  statusDayOverviewResponse,
  "groups" | "entries"
> & {
  groups: statusDayOverviewGroup[];
  entries: StatusDayOverviewEntry[];
};

export async function fetchStatusDayOverview(
  from: string,
  to: string,
  filters: { page: number; query: string; status: string; groupId: string },
): Promise<StatusDayOverview> {
  const overview = await bffJson("tenant", "GET /api/students/status-days", {
    query: {
      from,
      to,
      page: filters.page,
      page_size: 50,
      q: filters.query.trim() || undefined,
      status: filters.status === "all" ? undefined : filters.status,
      group_id: filters.groupId === "all" ? undefined : filters.groupId,
    },
  });
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
  const rows = await writeStatusDays(
    bffJson("tenant", "POST /api/students/{id}/status-days", {
      params: { id: studentId },
      body,
      errorMessage: "Geplante Einträge konnten nicht gespeichert werden",
    }),
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
  return writeStatusDays(
    bffJson("tenant", "POST /api/students/status-days/bulk", {
      body,
      errorMessage: "Klassenfahrt konnte nicht gespeichert werden",
    }),
  );
}

export async function deleteStudentStatusDay(
  studentId: string,
  statusDayId: string,
): Promise<void> {
  await bffJson(
    "tenant",
    "DELETE /api/students/{id}/status-days/{statusDayId}",
    {
      params: { id: studentId, statusDayId },
    },
  );
}
