/**
 * Staff client for the parent care-schedule change-request review queue
 * (#1803): the registered routes under
 * /api/students/care-schedule-change-requests, through the tenant BFF.
 */

import { ApiError } from "./api-error";
import { bffFile, bffJson } from "./bff-fetch";
import type * as studentsContract from "./contract/students.generated";
import { createLogger } from "~/lib/logger";
import { downloadBlob, filenameFromDisposition } from "~/lib/file-download";

const logger = createLogger({ component: "CareRequestReviewAPI" });

/** Wochenplan, einzelner Tag oder Abholberechtigung (#4780). */
type CareRequestKind =
  "weekly_schedule" | "pickup_change" | "pickup_permission";

type CareRequestStatus =
  "pending" | "approved" | "rejected" | "withdrawn" | "done" | "care_ended";

// One care-schedule change request in the staff queue. Mirrors
// api/students.CareRequestResponse.
export interface StaffCareRequest {
  readonly id: string;
  readonly student_id: string;
  readonly first_name: string;
  readonly last_name: string;
  readonly status: CareRequestStatus;
  readonly request_kind: CareRequestKind;
  readonly diff: readonly studentsContract.CareRequestDiffResponse[];
  readonly request_reason?: string;
  readonly decision_reason?: string;
  readonly created_at: string;
  readonly reviewed_at?: string;
  readonly affected_blocks: readonly studentsContract.AffectedCareBlock[];
  readonly impact_available: boolean;
  readonly impact_token: string;
  /** Die Eltern haben die Anfrage unterschrieben (#4780). */
  readonly signed?: boolean;
}

/**
 * Logs a failed call. The backend's stable 409 `code` (e.g.
 * "students.guardian_access_revoked", "students.change_request_not_pending")
 * travels on the ApiError and lets the review UI name the concrete recovery
 * action; `status` tells "gone" from "no access".
 */
function logFailure(error: unknown): never {
  if (error instanceof ApiError) {
    logger.error("care_request_review_request_failed", {
      status: error.status,
      message: error.message,
      ...(error.code ? { code: error.code } : {}),
    });
  }
  throw error;
}

/** Approves (applies the weekly plan) or rejects one care-schedule request. */
export function decideCareScheduleChangeRequest(
  requestId: string,
  approve: boolean,
  reason: string | undefined,
  impactToken: string,
  expectedVersion?: string,
): Promise<studentsContract.CareRequestResponse> {
  return bffJson(
    "tenant",
    "POST /api/students/care-schedule-change-requests/{requestId}/decide",
    {
      params: { requestId },
      body: {
        approve,
        reason: reason ?? "",
        impact_token: impactToken,
        ...(expectedVersion ? { expected_version: expectedVersion } : {}),
      },
      errorMessage: "Entscheidung konnte nicht gespeichert werden",
    },
  ).catch(logFailure);
}

/**
 * One decided care-schedule change request in the staff history. Mirrors
 * api/students.CareRequestHistoryResponse: `diff` replays the alt → neu
 * comparison frozen at decision time (#2430); rows decided before the
 * snapshot existed (and withdrawals) omit it, and the payload-derived
 * requested summary (each entry's old side empty) is the fallback.
 */
export interface StaffCareRequestHistoryEntry {
  readonly id: string;
  readonly student_id: string;
  readonly first_name: string;
  readonly last_name: string;
  readonly status: CareRequestStatus;
  readonly request_kind: CareRequestKind;
  readonly requested: readonly studentsContract.CareRequestDiffResponse[];
  /** Frozen decision-time diff; absent without a snapshot. */
  readonly diff?: readonly studentsContract.CareRequestDiffResponse[];
  readonly decision_reason?: string;
  readonly created_at: string;
  readonly decided_at: string;
  /** Absent for withdrawn rows (no reviewer). */
  readonly decided_by_name?: string;
}

/**
 * Loads one care-schedule request by its row id, whatever its status. The
 * backend answers 404 for a removed or foreign row and 403 for a child the
 * reader may not review; both arrive as ApiError with `status`.
 */
export function fetchCareScheduleChangeRequest(
  requestId: string,
): Promise<studentsContract.CareRequestDetailResponse> {
  return bffJson(
    "tenant",
    "GET /api/students/care-schedule-change-requests/{requestId}",
    {
      params: { requestId },
      errorMessage: "Anfrage konnte nicht geladen werden",
    },
  ).catch(logFailure);
}

/**
 * Lädt den Nachweis einer unterschriebenen Elternanfrage als PDF (#4780).
 */
export async function downloadCareRequestProofPdf(
  requestId: string,
): Promise<void> {
  const response = await bffFile(
    "tenant",
    "GET /api/students/care-schedule-change-requests/{requestId}/proof",
    {
      params: { requestId },
      errorMessage: "Nachweis konnte nicht geladen werden",
    },
  ).catch(logFailure);
  downloadBlob(
    await response.blob(),
    filenameFromDisposition(response) ?? "nachweis-elternanfrage.pdf",
  );
}
