/**
 * Staff client for the parent absence-request review queue: the registered
 * routes under /api/students/excused-absence-requests, through the tenant
 * BFF. Mirrors care-request-review-api.ts.
 */

import { ApiError } from "./api-error";
import { bffJson } from "./bff-fetch";
import type * as studentsContract from "./contract/students.generated";
import { createLogger } from "~/lib/logger";

const logger = createLogger({ component: "ExcusedRequestReviewAPI" });

type ExcusedRequestStatus = "pending" | "approved" | "rejected" | "withdrawn";

// One absence request in the staff queue. Mirrors
// api/students.StaffExcusedRequestResponse. `dates` are YYYY-MM-DD.
export interface StaffExcusedRequest {
  readonly id: string;
  readonly student_id: string;
  readonly first_name: string;
  readonly last_name: string;
  readonly absence_status: "sick" | "excused";
  readonly status: ExcusedRequestStatus;
  readonly dates: readonly string[];
  readonly note: string;
  readonly reason?: string;
  readonly created_at: string;
  readonly reviewed_at?: string;
}

/**
 * Logs a failed call. The backend's stable 409 `code` (e.g.
 * "students.change_request_not_pending") travels on the ApiError and lets
 * the review UI name the concrete recovery action.
 */
function logFailure(error: unknown): never {
  if (error instanceof ApiError) {
    logger.error("excused_request_review_request_failed", {
      status: error.status,
      message: error.message,
      ...(error.code ? { code: error.code } : {}),
    });
  }
  throw error;
}

/** Approves (marks the child absent) or rejects one absence request. */
export function decideExcusedAbsenceRequest(
  requestId: string,
  approve: boolean,
  reason?: string,
  expectedVersion?: string,
  /** Ersetzt die Teilentschuldigungen der Tage (#5698); nur nach Bestätigung. */
  replacePartialAbsences = false,
): Promise<studentsContract.StaffExcusedRequestResponse> {
  return bffJson(
    "tenant",
    "POST /api/students/excused-absence-requests/{requestId}/decide",
    {
      params: { requestId },
      body: {
        approve,
        reason: reason ?? "",
        ...(expectedVersion ? { expected_version: expectedVersion } : {}),
        ...(replacePartialAbsences ? { replace_partial_absences: true } : {}),
      },
      errorMessage: "Entscheidung konnte nicht gespeichert werden",
    },
  ).catch(logFailure);
}

/**
 * One decided absence request in the staff history. Mirrors
 * api/students.StaffExcusedRequestHistoryResponse.
 */
export interface StaffExcusedRequestHistoryEntry extends StaffExcusedRequest {
  readonly decided_at: string;
  /** Absent for withdrawn rows (no reviewer). */
  readonly decided_by_name?: string;
}
