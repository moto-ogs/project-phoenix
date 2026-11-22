/**
 * Staff client for the combined Änderungsanfragen queue. The review lists have
 * their own per-queue clients (care-request-review-api, master-data-review-*);
 * this module only exposes the cross-queue pending count that drives the
 * sidebar badge.
 */

import { ApiError } from "~/lib/api-error";
import { bffJson } from "~/lib/bff-fetch";
import {
  isParentRequestReviewAccess,
  isStudentRequestReviewCoverage,
  type ParentRequestReviewAccess,
  type StudentRequestReviewCoverage,
} from "~/lib/change-request-access";

/**
 * Fetches the combined number of pending parent change requests (master-data +
 * care schedule) for the tenant. Mirrors fetchUnreadCount: returns 0 on any
 * failure so a badge fetch can never break the sidebar.
 */
export async function fetchPendingChangeRequestCount(): Promise<number> {
  try {
    const counts = await bffJson(
      "tenant",
      "GET /api/students/change-requests/pending-count",
    );
    return counts?.pending_count ?? 0;
  } catch {
    return 0;
  }
}

export async function fetchChangeRequestAccess(): Promise<ParentRequestReviewAccess> {
  const answer = await bffJson(
    "tenant",
    "GET /api/students/change-requests/access",
  );
  const access = answer?.review_access;
  if (!isParentRequestReviewAccess(access)) {
    throw new ApiError("Change request access response is invalid", 500);
  }
  return access;
}

/**
 * Fragt, ob der Prüfbereich der angemeldeten Person ein Kind abdeckt (#3886).
 * Der Nachrichtenverlauf bietet „Anfrage ansehen“ nur dann an; sonst endete
 * der Klick in einem 403 der Detailansicht.
 */
export async function fetchStudentRequestReviewCoverage(
  studentId: string,
): Promise<StudentRequestReviewCoverage> {
  const answer = await bffJson(
    "tenant",
    "GET /api/students/change-requests/access",
    { query: { student_id: studentId } },
  );
  const coverage = answer?.student;
  if (!isStudentRequestReviewCoverage(coverage)) {
    throw new ApiError(
      "Student request review coverage response is invalid",
      500,
    );
  }
  return coverage;
}
