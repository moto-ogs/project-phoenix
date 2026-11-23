/**
 * Staff client for the post-enrollment offering change-request review queue
 * (#1665): the registered routes under /api/students/offering-change-requests,
 * through the tenant BFF.
 */

import type * as studentsContract from "~/lib/contract/students.generated";
import { requiredEnum } from "~/lib/contract/known-enum";
import { ApiError } from "./api-error";
import { bffJson } from "./bff-fetch";
import { createLogger } from "~/lib/logger";

const logger = createLogger({ component: "OfferingRequestReviewAPI" });

const OFFERING_REQUEST_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "withdrawn",
  "done",
  "care_ended",
] as const;
type OfferingRequestStatus = (typeof OFFERING_REQUEST_STATUSES)[number];

/**
 * One offering change request in the staff queue: the generated response
 * with its closed status and a `diff` that is never `null`.
 */
export type StaffOfferingRequest = Omit<
  studentsContract.OfferingRequestResponse,
  "status" | "diff"
> & {
  readonly status: OfferingRequestStatus;
  readonly diff: readonly studentsContract.OfferingRequestDiffResponse[];
};

export function toStaffOfferingRequest(
  request: studentsContract.OfferingRequestResponse,
): StaffOfferingRequest {
  return {
    ...request,
    status: requiredEnum(OFFERING_REQUEST_STATUSES, request.status, "status"),
    diff: request.diff ?? [],
  };
}

type WithLists<T, K extends keyof T> = Omit<T, K> & {
  readonly [P in K]: NonNullable<T[P]>;
};

/** The review card's preview; Go may write its lists as `null`. */
export type OfferingRequestPreview = Omit<
  WithLists<
    studentsContract.OfferingRequestPreviewResponse,
    "selections" | "manual_planning_conflicts"
  >,
  "manual_planning_conflicts"
> & {
  readonly manual_planning_conflicts: readonly WithLists<
    studentsContract.ManualPlanningConflictResponse,
    "days"
  >[];
};

/** Logs a failed call; the ApiError keeps the backend's code and detail. */
function logFailure(error: unknown): never {
  if (error instanceof ApiError) {
    logger.error("offering_request_review_request_failed", {
      status: error.status,
      message: error.message,
      ...(error.code ? { code: error.code } : {}),
    });
  }
  throw error;
}

/**
 * Approves (applies the dated switch) or rejects one offering change request.
 * Approval can legitimately fail (capacity, deactivated offering); the row then
 * stays pending on purpose.
 */
export async function decideOfferingChangeRequest(
  requestId: string,
  approve: boolean,
  reason: string | undefined,
  excludedOfferingIds: readonly string[] | undefined,
  effectiveFrom: string | undefined,
  completeWithdrawalConfirmed: boolean,
  /** Die Fassung der Anfrage aus der Liste (ADR 0311). */
  expectedVersion: string,
): Promise<studentsContract.rosterImpactResponse | undefined> {
  const answer = await bffJson(
    "tenant",
    "POST /api/students/offering-change-requests/{requestId}/decide",
    {
      params: { requestId },
      body: {
        approve,
        reason: reason ?? "",
        excluded_offering_ids: excludedOfferingIds
          ? [...excludedOfferingIds]
          : undefined,
        effective_from: effectiveFrom,
        ...(completeWithdrawalConfirmed
          ? { complete_withdrawal_confirmed: true }
          : {}),
        expected_version: expectedVersion,
      },
      errorMessage: "Entscheidung konnte nicht gespeichert werden",
    },
  ).catch(logFailure);
  // Eine Freigabe meldet, was sie im Betreuungsplan bewirkt hat (#5102).
  return answer?.roster_impact;
}

/** Materializes the review card with its current co-booking overrides. */
export async function previewOfferingChangeRequest(
  requestId: string,
  excludedOfferingIds: readonly string[],
  effectiveFrom?: string,
): Promise<OfferingRequestPreview> {
  const answer = await bffJson(
    "tenant",
    "POST /api/students/offering-change-requests/{requestId}/preview",
    {
      params: { requestId },
      body: {
        excluded_offering_ids: [...excludedOfferingIds],
        effective_from: effectiveFrom,
      },
      errorMessage: "Vorschau konnte nicht aktualisiert werden",
    },
  ).catch(logFailure);
  return {
    ...answer,
    selections: answer.selections ?? [],
    manual_planning_conflicts: (answer.manual_planning_conflicts ?? []).map(
      (conflict) => ({ ...conflict, days: conflict.days ?? [] }),
    ),
  };
}

/**
 * One decided offering change request in the staff history. Mirrors
 * api/students.OfferingRequestHistoryResponse; the diff is the frozen
 * decision snapshot, never recomputed against current bookings.
 */
export type StaffOfferingRequestHistoryEntry = Omit<
  studentsContract.OfferingRequestHistoryResponse,
  "status" | "diff"
> & {
  readonly status: OfferingRequestStatus;
  readonly diff: readonly studentsContract.OfferingRequestDiffResponse[];
};

export function toStaffOfferingRequestHistoryEntry(
  entry: studentsContract.OfferingRequestHistoryResponse,
): StaffOfferingRequestHistoryEntry {
  return {
    ...entry,
    status: requiredEnum(OFFERING_REQUEST_STATUSES, entry.status, "status"),
    diff: entry.diff ?? [],
  };
}
