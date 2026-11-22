/**
 * Staff client for the parent Stammdaten change-request review queue: the
 * registered routes under /api/students/master-data-change-requests, through
 * the tenant BFF.
 */

import { ApiError } from "~/lib/api-error";
import { bffJson } from "~/lib/bff-fetch";
import type * as studentsContract from "~/lib/contract/students.generated";
import { createLogger } from "~/lib/logger";

const logger = createLogger({ component: "MasterDataReviewAPI" });

type ChangeRequestStatus = "auto_applied" | "pending" | "approved" | "rejected";

// One pending change request in the staff queue. Mirrors
// api/students.MasterDataChangeRequestResponse.
export interface StaffMasterDataChange {
  readonly id: string;
  readonly student_id: string;
  readonly first_name: string;
  readonly last_name: string;
  readonly target: string;
  readonly field_key: string;
  readonly old_value?: unknown;
  readonly new_value: unknown;
  readonly status: ChangeRequestStatus;
  readonly created_at: string;
  readonly reviewed_at?: string;
}

function logFailure(error: unknown): never {
  if (error instanceof ApiError) {
    logger.error("master_data_review_request_failed", {
      status: error.status,
      ...(error.code ? { code: error.code } : {}),
    });
  }
  throw error;
}

/** Approves (and applies) or rejects one change request. */
export function decideMasterDataChangeRequest(
  requestId: string,
  approve: boolean,
  reason?: string,
  expectedVersion?: string,
): Promise<studentsContract.MasterDataChangeRequestResponse> {
  return bffJson(
    "tenant",
    "POST /api/students/master-data-change-requests/{requestId}/decide",
    {
      params: { requestId },
      body: {
        approve,
        reason: reason ?? "",
        ...(expectedVersion ? { expected_version: expectedVersion } : {}),
      },
      errorMessage: "master data decision failed",
    },
  ).catch(logFailure);
}

/**
 * One decided Stammdaten change request in the staff history. Mirrors
 * api/students.MasterDataChangeRequestHistoryResponse.
 */
export interface StaffMasterDataHistoryEntry extends StaffMasterDataChange {
  readonly decided_at: string;
  /** Absent for auto-applied rows (no reviewer). */
  readonly decided_by_name?: string;
  readonly review_reason?: string;
}
