// app/api/activities/[id]/students/route.ts
import type { NextRequest } from "next/server";
import { apiGet, apiPut, bffError } from "~/lib/api-helpers.server";
import { createLogger } from "~/lib/logger";

const logger = createLogger({ component: "ActivityStudentsRoute" });
import { createGetHandler, createPutHandler } from "~/lib/route-wrapper.server";
import {
  mapStudentEnrollmentsResponse,
  type StudentEnrollmentBody,
} from "~/lib/activity-helpers";
import { int64String } from "~/lib/contract/runtime";

interface StudentListPage {
  data?: Array<{
    id: string;
    first_name: string;
    last_name: string;
    school_class?: string;
  }>;
  pagination?: {
    current_page: number;
    page_size: number;
    total_pages: number;
    total_records: number;
  };
}

// Reject oversized/inconsistent responses, never truncate them into a success.
const MAX_STUDENT_PAGES = 1_000;

/** The student ID as a decimal string, or null unless it is a positive int64. */
function studentIdOf(value: unknown): string | null {
  const parsed = int64String.safeParse(value);
  if (!parsed.success || parsed.data === "0" || parsed.data.startsWith("-")) {
    return null;
  }
  return parsed.data;
}

function failStudentPagination(reason: string): never {
  logger.error("invalid_student_pagination", { reason });
  throw bffError(502, "Invalid student list pagination", {
    code: "general.unavailable",
  });
}

async function fetchAllStudents(params: URLSearchParams, token: string) {
  const firstResponse = await apiGet<StudentListPage>(
    `/api/students?${params.toString()}`,
    token,
  );
  const pagination = firstResponse.pagination;
  if (!pagination) failStudentPagination("missing pagination");
  // Freeze the traversal plan; later responses cannot extend the work.
  const {
    total_pages: totalPages,
    total_records: totalRecords,
    page_size: pageSize,
  } = pagination;
  if (
    !Number.isSafeInteger(totalPages) ||
    totalPages < 0 ||
    totalPages > MAX_STUDENT_PAGES ||
    !Number.isSafeInteger(totalRecords) ||
    totalRecords < 0 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    totalPages !== Math.ceil(totalRecords / pageSize)
  ) {
    failStudentPagination("invalid pagination bounds");
  }

  const students: Array<
    NonNullable<StudentListPage["data"]>[number] & { id: string }
  > = [];
  const seenIds = new Set<string>();
  for (let page = 1; page <= Math.max(1, totalPages); page++) {
    let response = firstResponse;
    if (page > 1) {
      params.set("page", String(page));
      response = await apiGet<StudentListPage>(
        `/api/students?${params.toString()}`,
        token,
      );
    }
    if (
      response.pagination?.current_page !== page ||
      response.pagination.page_size !== pageSize ||
      response.pagination.total_pages !== totalPages ||
      response.pagination.total_records !== totalRecords
    ) {
      failStudentPagination("page metadata changed");
    }
    const data = response.data ?? [];
    const expectedCount = Math.min(
      pageSize,
      totalRecords - (page - 1) * pageSize,
    );
    if (!Array.isArray(data) || data.length !== expectedCount) {
      failStudentPagination("unexpected page length");
    }
    for (const student of data) {
      const studentId = student ? studentIdOf(student.id) : null;
      if (!student || studentId === null || seenIds.has(studentId)) {
        failStudentPagination("invalid or repeated student ID");
      }
      seenIds.add(studentId);
      students.push({ ...student, id: studentId });
    }
  }
  if (students.length !== totalRecords) {
    failStudentPagination("student count differs from total_records");
  }
  return students;
}

/**
 * Handler for GET /api/activities/[id]/students
 * Returns a list of students enrolled in a specific activity
 */
export const GET = createGetHandler(
  async (
    request: NextRequest,
    token: string,
    params: Record<string, unknown>,
  ) => {
    const id = params.id as string;

    // Check for "available" query parameter - return available students instead of enrolled ones
    const available = request.nextUrl.searchParams.get("available") === "true";

    if (available) {
      // Get query parameters for filtering
      const search = request.nextUrl.searchParams.get("search") ?? undefined;
      const groupId = request.nextUrl.searchParams.get("group_id") ?? undefined;

      // Get available students by fetching all students and filtering out enrolled ones
      try {
        const allStudentsParams = new URLSearchParams();
        if (search) allStudentsParams.append("search", search);
        if (groupId) allStudentsParams.append("group_id", groupId);

        // The roster and paginated candidate list are independent reads.
        const [enrolledResponse, allStudents] = await Promise.all([
          apiGet<{ data: StudentEnrollmentBody[] }>(
            `/api/activities/${encodeURIComponent(id)}/students`,
            token,
          ),
          fetchAllStudents(allStudentsParams, token),
        ]);
        const enrolledStudentIds = new Set(
          (enrolledResponse.data ?? []).map((e) => String(e.id)),
        );

        // Filter out enrolled students and format for frontend
        const availableStudents = allStudents
          .filter((student) => !enrolledStudentIds.has(student.id))
          .map((student) => ({
            id: student.id,
            name: `${student.first_name} ${student.last_name}`.trim(),
            school_class: student.school_class ?? "",
          }));

        return availableStudents;
      } catch (error) {
        logger.error("failed to fetch available students", {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    // Otherwise return enrolled students - call backend directly
    try {
      const endpoint = `/api/activities/${encodeURIComponent(id)}/students`;
      const response = await apiGet<{ data: StudentEnrollmentBody[] }>(
        endpoint,
        token,
      );
      return mapStudentEnrollmentsResponse(response.data ?? []);
    } catch (error) {
      logger.error("failed to fetch enrolled students", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
);

/**
 * Handler for PUT /api/activities/[id]/students
 * Updates the complete list of enrolled students (replaces existing enrollments)
 */
export const PUT = createPutHandler(
  async (
    _request: NextRequest,
    body: { student_ids: string[] },
    token: string,
    params: Record<string, unknown>,
  ) => {
    const id = params.id as string;

    if (!body.student_ids || !Array.isArray(body.student_ids)) {
      throw new Error("student_ids array is required");
    }

    // Go reads each ID as a decimal string or a number; the strings pass
    // through unchanged, so no ID is rounded on the way.
    const endpoint = `/api/activities/${encodeURIComponent(id)}/students`;
    await apiPut(endpoint, token, { student_ids: body.student_ids });

    // Return updated enrolled students - call backend directly with token
    const response = await apiGet<{ data: StudentEnrollmentBody[] }>(
      endpoint,
      token,
    );
    return mapStudentEnrollmentsResponse(response.data ?? []);
  },
);
