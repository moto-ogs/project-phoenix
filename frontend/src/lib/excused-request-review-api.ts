/**
 * Staff client for the parent absence-request review queue: the registered
 * routes under /api/students/excused-absence-requests, through the tenant
 * BFF. Mirrors care-request-review-api.ts.
 */

import { ApiError } from "./api-error";
import { bffJson } from "./bff-fetch";
import type * as studentsContract from "./contract/students.generated";
import { requiredEnum } from "./contract/known-enum";
import { createLogger } from "~/lib/logger";

const logger = createLogger({ component: "ExcusedRequestReviewAPI" });

const EXCUSED_REQUEST_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "withdrawn",
] as const;
const ABSENCE_STATUSES = ["sick", "excused"] as const;

type Narrowed = "status" | "absence_status" | "dates";

interface ExcusedRequestFields {
  readonly status: (typeof EXCUSED_REQUEST_STATUSES)[number];
  readonly absence_status: (typeof ABSENCE_STATUSES)[number];
  readonly dates: readonly string[];
}

/** The generated request with its closed values; `dates` never `null`. */
export type StaffExcusedRequest = Omit<
  studentsContract.StaffExcusedRequestResponse,
  Narrowed
> &
  ExcusedRequestFields;

function excusedFields(
  request: Pick<studentsContract.StaffExcusedRequestResponse, Narrowed>,
): ExcusedRequestFields {
  return {
    status: requiredEnum(EXCUSED_REQUEST_STATUSES, request.status, "status"),
    absence_status: requiredEnum(
      ABSENCE_STATUSES,
      request.absence_status,
      "absence_status",
    ),
    dates: request.dates ?? [],
  };
}

export function toStaffExcusedRequest(
  request: studentsContract.StaffExcusedRequestResponse,
): StaffExcusedRequest {
  return { ...request, ...excusedFields(request) };
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
export type StaffExcusedRequestHistoryEntry = Omit<
  studentsContract.StaffExcusedRequestHistoryResponse,
  Narrowed
> &
  ExcusedRequestFields;

export function toStaffExcusedRequestHistoryEntry(
  entry: studentsContract.StaffExcusedRequestHistoryResponse,
): StaffExcusedRequestHistoryEntry {
  return { ...entry, ...excusedFields(entry) };
}
