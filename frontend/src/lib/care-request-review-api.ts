/**
 * Staff client for the parent care-schedule change-request review queue
 * (#1803): the registered routes under
 * /api/students/care-schedule-change-requests, through the tenant BFF.
 */

import { ApiError } from "./api-error";
import { bffFile, bffJson } from "./bff-fetch";
import type * as studentsContract from "./contract/students.generated";
import { knownEnum, requiredEnum } from "./contract/known-enum";
import { createLogger } from "~/lib/logger";
import { downloadBlob, filenameFromDisposition } from "~/lib/file-download";
import type { RequestDiffEntry } from "~/lib/messaging-status";

const logger = createLogger({ component: "CareRequestReviewAPI" });

/** Wochenplan, einzelner Tag oder Abholberechtigung (#4780). */
const CARE_REQUEST_KINDS = [
  "weekly_schedule",
  "pickup_change",
  "pickup_permission",
] as const;
type CareRequestKind = (typeof CARE_REQUEST_KINDS)[number];

const CARE_REQUEST_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "withdrawn",
  "done",
  "care_ended",
] as const;
type CareRequestStatus = (typeof CARE_REQUEST_STATUSES)[number];

const CARE_KINDS = [
  "arrival",
  "pickup",
  "departure_mode",
  "pickup_person",
] as const;

/** A diff row; an unknown `care_kind` falls back to the German `label`. */
function diffEntry(
  entry: studentsContract.CareRequestDiffResponse,
): RequestDiffEntry {
  return { ...entry, care_kind: knownEnum(CARE_KINDS, entry.care_kind) };
}

/**
 * One care-schedule change request in the staff queue: the generated
 * response with its closed status and kind, and its lists Go may send as
 * `null` read as empty (toStaffCareRequest).
 */
export type StaffCareRequest = Omit<
  studentsContract.CareRequestResponse,
  "status" | "request_kind" | "diff" | "affected_blocks"
> & {
  readonly status: CareRequestStatus;
  readonly request_kind: CareRequestKind;
  readonly diff: readonly RequestDiffEntry[];
  readonly affected_blocks: readonly studentsContract.AffectedCareBlock[];
};

/** A status or kind this build does not know fails the read (ADR 0270). */
export function toStaffCareRequest(
  request: studentsContract.CareRequestResponse,
): StaffCareRequest {
  return {
    ...request,
    status: requiredEnum(CARE_REQUEST_STATUSES, request.status, "status"),
    request_kind: requiredEnum(
      CARE_REQUEST_KINDS,
      request.request_kind,
      "request_kind",
    ),
    diff: (request.diff ?? []).map(diffEntry),
    affected_blocks: request.affected_blocks ?? [],
  };
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
export type StaffCareRequestHistoryEntry = Omit<
  studentsContract.CareRequestHistoryResponse,
  "status" | "request_kind" | "requested" | "diff"
> & {
  readonly status: CareRequestStatus;
  readonly request_kind: CareRequestKind;
  readonly requested: readonly RequestDiffEntry[];
  /** Frozen decision-time diff; absent without a snapshot. */
  readonly diff?: readonly RequestDiffEntry[];
};

export function toStaffCareRequestHistoryEntry(
  entry: studentsContract.CareRequestHistoryResponse,
): StaffCareRequestHistoryEntry {
  const { diff, ...rest } = entry;
  return {
    ...rest,
    status: requiredEnum(CARE_REQUEST_STATUSES, entry.status, "status"),
    request_kind: requiredEnum(
      CARE_REQUEST_KINDS,
      entry.request_kind,
      "request_kind",
    ),
    requested: (entry.requested ?? []).map(diffEntry),
    ...(diff ? { diff: diff.map(diffEntry) } : {}),
  };
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
