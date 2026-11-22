/**
 * Staff client for the post-enrollment offering change-request review queue
 * (#1665): the registered routes under /api/students/offering-change-requests,
 * through the tenant BFF.
 */

import type * as studentsContract from "~/lib/contract/students.generated";
import { ApiError } from "./api-error";
import { bffJson } from "./bff-fetch";
import { createLogger } from "~/lib/logger";

const logger = createLogger({ component: "OfferingRequestReviewAPI" });

type OfferingRequestStatus = "pending" | "approved" | "rejected" | "withdrawn";

/** One "current → requested" line, pre-rendered in German by the backend. */
export interface OfferingRequestDiffLine {
  readonly offering_id: string;
  readonly label: string;
  readonly old: string;
  readonly new: string;
  /** True when a Mitbuchungs-Regel (or the required lunch) added days here. */
  readonly automatic?: boolean;
  /** German day list of the automatic share ("Do, Fr"). */
  readonly automatic_days?: string;
  /** Rule-derived part of automatic_days, excluding required-lunch days. */
  readonly rule_days?: string;
  /** Materialized German day list after this co-booking rule is suppressed. */
  readonly new_when_excluded?: string;
  /** Offerings whose rule produced the automatic share (for cascade greying). */
  readonly trigger_ids?: readonly string[];
  readonly trigger_names?: readonly string[];
  /** True when staff may exclude this rule-added line per request (#2370). */
  readonly optoutable?: boolean;
  /** True for a Kurs — an AG the family reached through a care offering. */
  readonly is_course?: boolean;
}

/** One booking the request leaves exactly as it is. */
interface OfferingRequestUnchangedLine {
  readonly offering_id: string;
  readonly label: string;
  readonly days: string;
}

/**
 * One offering change request in the staff queue. Mirrors
 * api/students.OfferingRequestResponse.
 */
export interface StaffOfferingRequest {
  readonly id: string;
  readonly student_id: string;
  readonly student_name: string;
  readonly status: OfferingRequestStatus;
  /** Date the switch would take effect (YYYY-MM-DD). */
  readonly effective_from: string;
  /**
   * Range staff may confirm the switch for (YYYY-MM-DD, #2484). Absent when the
   * backend could not resolve the care period; the date field is then unbounded
   * and the decision validates alone.
   */
  readonly earliest_effective_from?: string;
  readonly latest_effective_from?: string;
  /**
   * Das Datum, das die Eltern eingetragen haben — nur gesetzt, wenn es nicht
   * mehr geht (es ist vorbei oder liegt vor dem Beginn der Betreuungszeit) und
   * `effective_from` deshalb der früheste noch mögliche Tag ist (#2484).
   */
  readonly requested_effective_from?: string;
  readonly note?: string;
  readonly diff: readonly OfferingRequestDiffLine[];
  /** Bookings this request does not touch, for the complete after picture. */
  readonly unchanged?: readonly OfferingRequestUnchangedLine[];
  /** True when approving would leave the child without any offering (#2434). */
  readonly full_withdrawal?: boolean;
  readonly reason?: string;
  readonly created_at: string;
  readonly reviewed_at?: string;
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
  reason?: string,
  excludedOfferingIds?: readonly string[],
  effectiveFrom?: string,
  completeWithdrawalConfirmed?: boolean,
  expectedVersion?: string,
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
        ...(expectedVersion ? { expected_version: expectedVersion } : {}),
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
export interface StaffOfferingRequestHistoryEntry extends StaffOfferingRequest {
  readonly decided_at: string;
  /** Absent for withdrawn rows (no reviewer). */
  readonly decided_by_name?: string;
  /** Payload-derived recap when no frozen decision snapshot exists. */
  readonly requested?: readonly OfferingRequestRequestedLine[];
}

interface OfferingRequestRequestedLine {
  readonly offering_id: string;
  readonly label: string;
  readonly new: string;
}
