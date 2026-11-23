/**
 * Staff client for the parent Stammdaten change-request review queue: the
 * registered routes under /api/students/master-data-change-requests, through
 * the tenant BFF.
 */

import { ApiError } from "~/lib/api-error";
import { bffJson } from "~/lib/bff-fetch";
import type * as studentsContract from "~/lib/contract/students.generated";
import { requiredEnum } from "~/lib/contract/known-enum";
import { createLogger } from "~/lib/logger";

const logger = createLogger({ component: "MasterDataReviewAPI" });

const CHANGE_REQUEST_STATUSES = [
  "auto_applied",
  "pending",
  "approved",
  "rejected",
  "care_ended",
] as const;
type ChangeRequestStatus = (typeof CHANGE_REQUEST_STATUSES)[number];

/** The generated change with its closed status. */
export type StaffMasterDataChange = Omit<
  studentsContract.MasterDataChangeRequestResponse,
  "status"
> & { readonly status: ChangeRequestStatus };

export function toStaffMasterDataChange(
  change: studentsContract.MasterDataChangeRequestResponse,
): StaffMasterDataChange {
  return {
    ...change,
    status: requiredEnum(CHANGE_REQUEST_STATUSES, change.status, "status"),
  };
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
export type StaffMasterDataHistoryEntry = Omit<
  studentsContract.MasterDataChangeRequestHistoryResponse,
  "status"
> & { readonly status: ChangeRequestStatus };

export function toStaffMasterDataHistoryEntry(
  entry: studentsContract.MasterDataChangeRequestHistoryResponse,
): StaffMasterDataHistoryEntry {
  return {
    ...entry,
    status: requiredEnum(CHANGE_REQUEST_STATUSES, entry.status, "status"),
  };
}
