import { ApiError } from "~/lib/api-error";
import { bffFile, bffJson } from "~/lib/bff-fetch";
import { knownEnum, requiredEnum } from "~/lib/contract/known-enum";
import type * as enrollmentContract from "~/lib/contract/enrollment.generated";
import type * as sharedContract from "~/lib/contract/shared.generated";
import type * as studentsContract from "~/lib/contract/students.generated";
import {
  knownMailOutcome,
  type EmailAddressMark,
  type MailOutcome,
} from "~/lib/email-delivery-status";
import { announceEnrollmentReadChange } from "~/lib/enrollment-unread-api";
import { createLogger } from "~/lib/logger";
import {
  bootstrapFromContract,
  changeRequestFromContract,
  signatureFromContract,
  type EnrollmentChangeRequest,
  type EnrollmentSignature,
  type PublicEnrollmentBootstrap,
} from "~/lib/enrollment-submission-api";
import {
  SELECTION_MODES,
  type CareOfferingSelectionMode,
} from "~/lib/enrollment-phase-api";
import { downloadBlob, filenameFromDisposition } from "~/lib/file-download";
import {
  formLabelsFromContract,
  type EnrollmentFormLabels,
} from "~/lib/enrollment-change-request-diff";
import { logEnrollmentFailure } from "~/lib/enrollment-api-error";
import {
  CHILD_STATUSES,
  type ChangeRequestStatus,
  type ChildStatus,
} from "~/lib/enrollment-status";
import type { EnrollmentExportFormat } from "~/lib/enrollment-report-api";

const logger = createLogger({ component: "EnrollmentAdminAPI" });

// Go does not register these sets; the contract types them as string.
const TERM_CHANGES = ["price", "days", "activity"] as const;
const ADDRESS_MARKS = ["failed", "complained"] as const;

/** An object answer the contract carries as unknown (form answers, consents). */
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export type DecisionStatus =
  "approved" | "waitlisted" | "rejected" | "under_review";

export interface UpdateAdminChildOfferingsInput {
  offerings: Array<{ offering_id: string; selected_days?: string[] }>;
  reason: string;
  completeWithdrawalConfirmed?: boolean;
}

/**
 * A booking of a request's child. The offering attributes match what the
 * parents app shows for the same booking (#2185); `valid_until` is the
 * inclusive last day; `starts_later` marks a booking not in effect yet,
 * display only. `submitted_terms` are the catalog terms the parents signed
 * (#6837); while a current booking lists `changed_terms`, the approval needs
 * `acceptOfferingChanges`.
 */
export type AdminRequestChildOffering = Omit<
  enrollmentContract.AdminRequestChildOffering,
  "submitted_terms" | "changed_terms"
> & {
  submitted_terms?: Omit<
    enrollmentContract.AdminSubmittedOfferingTerms,
    "available_days"
  > & { available_days: string[] };
  /** The changes this build knows. */
  changed_terms?: (typeof TERM_CHANGES)[number][];
};

function childOfferingFromContract(
  offering: enrollmentContract.AdminRequestChildOffering,
): AdminRequestChildOffering {
  const { submitted_terms: terms, changed_terms: changes, ...rest } = offering;
  return {
    ...rest,
    ...(terms && {
      submitted_terms: { ...terms, available_days: terms.available_days ?? [] },
    }),
    ...(changes && {
      changed_terms: changes.flatMap((change) => {
        const known = knownEnum(TERM_CHANGES, change);
        return known ? [known] : [];
      }),
    }),
  };
}

/**
 * A booking as an adjustment recorded it. The contract carries `before` and
 * `after` as unknown (the backend stores the snapshot as JSON), so this is
 * the shape the backend writes there.
 */
interface AdminOfferingAdjustmentSnapshot {
  offering_id: string;
  offering_name?: string;
  days_of_week_mode?: string;
  selected_days?: string[];
  manual_selected_days?: string[];
  automatic_selected_days?: string[];
  available_days?: string[];
}

export type AdminOfferingAdjustment = Omit<
  enrollmentContract.AdminOfferingAdjustment,
  "before" | "after"
> & {
  before: AdminOfferingAdjustmentSnapshot[];
  after: AdminOfferingAdjustmentSnapshot[];
};

function snapshots(value: unknown): AdminOfferingAdjustmentSnapshot[] {
  return Array.isArray(value)
    ? (value as AdminOfferingAdjustmentSnapshot[])
    : [];
}

/**
 * The other active enrollment of the same phase that already created or
 * renews a candidate (#6247). The phase takes the child only once, so the
 * enrollment at hand duplicates that one.
 */
export type AdminCandidatePhaseRequest = Omit<
  enrollmentContract.AdminCandidatePhaseRequest,
  "child_status"
> & { child_status: ChildStatus };

/** An enrolled child that may be the child of an enrollment (#6053). */
export type AdminExistingChildCandidate = Omit<
  enrollmentContract.AdminExistingChildCandidate,
  "phase_request"
> & { phase_request?: AdminCandidatePhaseRequest };

function candidateFromContract(
  candidate: enrollmentContract.AdminExistingChildCandidate,
): AdminExistingChildCandidate {
  const { phase_request: other, ...rest } = candidate;
  return {
    ...rest,
    ...(other && {
      phase_request: {
        ...other,
        child_status: requiredEnum(
          CHILD_STATUSES,
          other.child_status,
          "AdminCandidatePhaseRequest.child_status",
        ),
      },
    }),
  };
}

/**
 * A child of a request. While `possible_existing_children` is non-empty,
 * approving needs the office's choice (#6053). `review_reason` names why an
 * open enrollment was left to the school (#3570); `weekly_plan_on` is the
 * day a renewal's weekly plan applies (#6043). `offerings` is what a
 * correction replaces; `upcoming_offerings` take effect later and are
 * display only (#2185); `offerings_unavailable` blocks corrections.
 */
export type AdminRequestChild = Omit<
  enrollmentContract.AdminRequestChild,
  | "status"
  | "custom_data"
  | "possible_existing_children"
  | "offerings"
  | "upcoming_offerings"
> & {
  status: ChildStatus;
  custom_data?: Record<string, unknown>;
  possible_existing_children?: AdminExistingChildCandidate[];
  offerings?: AdminRequestChildOffering[];
  upcoming_offerings?: AdminRequestChildOffering[];
};

function requestChildFromContract(
  child: enrollmentContract.AdminRequestChild,
): AdminRequestChild {
  const {
    custom_data: customData,
    possible_existing_children: candidates,
    offerings,
    upcoming_offerings: upcoming,
    ...rest
  } = child;
  return {
    ...rest,
    status: requiredEnum(
      CHILD_STATUSES,
      child.status,
      "AdminRequestChild.status",
    ),
    ...(customData !== undefined && { custom_data: record(customData) }),
    ...(candidates && {
      possible_existing_children: candidates.map(candidateFromContract),
    }),
    ...(offerings && { offerings: offerings.map(childOfferingFromContract) }),
    ...(upcoming && {
      upcoming_offerings: upcoming.map(childOfferingFromContract),
    }),
  };
}

/**
 * A request in the staff lists. `is_unread` is per person (#3778). The
 * detail endpoint also fills `custom_data`, `consent_flags` and the pinned
 * schema's `schema_fields` and `schema_legal_blocks` that label them.
 */
export type AdminRequestSummary = Omit<
  enrollmentContract.AdminRequestSummary,
  "care_offering_selection_mode" | "custom_data" | "consent_flags" | "children"
> & {
  care_offering_selection_mode: CareOfferingSelectionMode;
  custom_data?: Record<string, unknown>;
  consent_flags?: Record<string, unknown>;
  children: AdminRequestChild[];
};

/**
 * A request the Träger office made from an imported care contract (ADR
 * 0309): no parents filled it in, none are attached, and no parent status
 * page belongs to it.
 */
export function fromImportedContract(request: {
  readonly submission_source: string;
}): boolean {
  return request.submission_source === "contract_import";
}

function requestSummaryFromContract(
  summary: enrollmentContract.AdminRequestSummary,
): AdminRequestSummary {
  const {
    custom_data: customData,
    consent_flags: consentFlags,
    children,
    ...rest
  } = summary;
  return {
    ...rest,
    care_offering_selection_mode: requiredEnum(
      SELECTION_MODES,
      summary.care_offering_selection_mode,
      "AdminRequestSummary.care_offering_selection_mode",
    ),
    ...(customData !== undefined && { custom_data: record(customData) }),
    ...(consentFlags !== undefined && { consent_flags: record(consentFlags) }),
    children: (children ?? []).map(requestChildFromContract),
  };
}

/** A change request with the request it belongs to. */
export type AdminEnrollmentChangeRequest = Omit<
  EnrollmentChangeRequest,
  "request"
> & {
  request?: AdminRequestSummary;
};

function adminChangeRequestFromContract(
  request: enrollmentContract.ChangeRequestResponse,
): AdminEnrollmentChangeRequest {
  const { request: summary, ...rest } = changeRequestFromContract(request);
  return {
    ...rest,
    ...(summary && { request: requestSummaryFromContract(summary) }),
  };
}

export type AdminChildDataCorrectionResult = AdminEnrollmentChangeRequest & {
  request: AdminRequestSummary;
};

/** A legal block as the request's evidence recorded it. */
export type AdminLegalEvidenceBlock = Omit<
  enrollmentContract.LegalBlockSnapshot,
  "translations"
> & {
  translations?: Record<
    string,
    { title?: string; label?: string; text?: string }
  >;
};

export type AdminLegalEvidenceEntry = Omit<
  enrollmentContract.AdminLegalEvidenceEntry,
  "blocks" | "consent_flags"
> & {
  blocks: AdminLegalEvidenceBlock[] | null;
  consent_flags: Record<string, unknown> | null;
};

function evidenceFromContract(
  entry: enrollmentContract.AdminLegalEvidenceEntry,
): AdminLegalEvidenceEntry {
  return {
    ...entry,
    blocks:
      entry.blocks &&
      entry.blocks.map(({ translations, ...block }) => ({
        ...block,
        ...(translations && {
          translations: Object.fromEntries(
            Object.entries(translations).flatMap(([locale, texts]) =>
              texts ? [[locale, texts]] : [],
            ),
          ),
        }),
      })),
    consent_flags:
      entry.consent_flags === null ? null : record(entry.consent_flags),
  };
}

/** A request's detail, with its evidence, uploads and signature (#4786). */
export type AdminRequestDetail = AdminRequestSummary &
  Omit<
    enrollmentContract.AdminRequestDetail,
    | keyof enrollmentContract.AdminRequestSummary
    | "legal_blocks_snapshot"
    | "uploads"
    | "signature"
  > & {
    legal_blocks_snapshot: AdminLegalEvidenceEntry[];
    uploads: enrollmentContract.AdminRequestUpload[];
    signature?: EnrollmentSignature;
  };

function requestDetailFromContract(
  detail: enrollmentContract.AdminRequestDetail,
): AdminRequestDetail {
  const {
    legal_blocks_snapshot: evidence,
    uploads,
    signature,
    custom_data: _customData,
    consent_flags: _consentFlags,
    children: _children,
    ...rest
  } = detail;
  return {
    ...rest,
    ...requestSummaryFromContract(detail),
    legal_blocks_snapshot: (evidence ?? []).map(evidenceFromContract),
    uploads: uploads ?? [],
    ...(signature && { signature: signatureFromContract(signature) }),
  };
}

/** What a deletion removes and keeps; `blocking_student_ids` stop it. */
export type AdminEnrollmentDeletionImpact = Omit<
  enrollmentContract.AdminEnrollmentDeletionImpact,
  "blocking_student_ids"
> & { blocking_student_ids: string[] };

function deletionImpactFromContract(
  impact: enrollmentContract.AdminEnrollmentDeletionImpact,
): AdminEnrollmentDeletionImpact {
  return {
    ...impact,
    blocking_student_ids: impact.blocking_student_ids ?? [],
  };
}

/**
 * The office's answer for a child that may already be enrolled (#6053). A new
 * child names the candidates the office saw: the backend refuses it again
 * when another one turned up meanwhile (#6247).
 */
export type ExistingChildChoice =
  | { existingStudentId: string }
  | { createNewStudent: true; shownStudentIds: readonly string[] };

/** The choice in the wire fields the decision and the manual enrollment take. */
export function existingChildChoiceFields(
  choice: ExistingChildChoice | undefined,
): {
  existing_student_id?: string;
  create_new_student?: true;
  shown_existing_student_ids?: string[];
} {
  if (!choice) return {};
  return "existingStudentId" in choice
    ? { existing_student_id: choice.existingStudentId }
    : {
        create_new_student: true,
        shown_existing_student_ids: [...choice.shownStudentIds],
      };
}

export interface ListAdminRequestsFilters {
  phaseId?: string;
  childStatus?: ChildStatus;
}

export async function listAdminRequests(
  filters: ListAdminRequestsFilters = {},
): Promise<AdminRequestSummary[]> {
  const requests = await bffJson(
    "tenant",
    "GET /api/enrollment/admin/requests/",
    {
      query: {
        phase_id: filters.phaseId || undefined,
        child_status: filters.childStatus,
      },
      errorMessage: "Anmeldungen konnten nicht geladen werden",
    },
  );
  return requests.map(requestSummaryFromContract);
}

export async function getAdminRequest(id: string): Promise<AdminRequestDetail> {
  return requestDetailFromContract(
    await bffJson("tenant", "GET /api/enrollment/admin/requests/{id}/", {
      params: { id },
      errorMessage: "Anmeldung konnte nicht geladen werden",
    }),
  );
}

const READ_FAILED =
  "Das hat leider nicht geklappt. Bitte versuche es noch einmal.";

/** Markiert eine Anmeldung für die Person als gelesen oder ungelesen. */
export async function setAdminRequestRead(
  id: string,
  read: boolean,
): Promise<void> {
  const options = { params: { id }, errorMessage: READ_FAILED };
  await (read
    ? bffJson("tenant", "PUT /api/enrollment/admin/requests/{id}/read", options)
    : bffJson(
        "tenant",
        "DELETE /api/enrollment/admin/requests/{id}/read",
        options,
      ));
  announceEnrollmentReadChange();
}

/** Markiert alle ungelesenen Anmeldungen der Person als gelesen. */
export async function markAllAdminRequestsRead(): Promise<void> {
  await bffJson("tenant", "POST /api/enrollment/admin/requests/mark-all-read", {
    errorMessage: READ_FAILED,
  });
  announceEnrollmentReadChange();
}

/** Nach dem Öffnen einer Anmeldung: das Badge neu zählen lassen. */
export function announceAdminRequestOpened() {
  announceEnrollmentReadChange();
}

/**
 * What became of one mail to the family of an application (#5934).
 * `created_at` is set only for the holiday registrations (#6976).
 */
export type AdminRequestMail = Omit<
  sharedContract.RequestMailOutcome,
  "outcome" | "address_mark"
> & {
  /** undefined: an outcome this build does not know; no status shows. */
  outcome: MailOutcome | undefined;
  address_mark?: EmailAddressMark;
};

export async function getAdminRequestMails(
  requestId: string,
): Promise<AdminRequestMail[]> {
  const mails = await bffJson(
    "tenant",
    "GET /api/enrollment/admin/requests/{id}/mails",
    {
      params: { id: requestId },
      errorMessage: "Der Stand der E-Mails konnte nicht geladen werden",
    },
  );
  return mails.map(({ address_mark: mark, ...mail }) => {
    const known = knownEnum(ADDRESS_MARKS, mark);
    return {
      ...mail,
      outcome: knownMailOutcome(mail.outcome),
      ...(known && { address_mark: known }),
    };
  });
}

const DELETE_IMPACT_FAILED =
  "Auswirkungen der Löschung konnten nicht geladen werden";

export async function getAdminRequestDeleteImpact(
  requestId: string,
): Promise<AdminEnrollmentDeletionImpact> {
  return deletionImpactFromContract(
    await bffJson(
      "tenant",
      "GET /api/enrollment/admin/requests/{id}/delete-impact",
      { params: { id: requestId }, errorMessage: DELETE_IMPACT_FAILED },
    ),
  );
}

export async function getAdminChildDeleteImpact(
  requestId: string,
  childId: string,
): Promise<AdminEnrollmentDeletionImpact> {
  return deletionImpactFromContract(
    await bffJson(
      "tenant",
      "GET /api/enrollment/admin/requests/{id}/children/{childId}/delete-impact",
      {
        params: { id: requestId, childId },
        errorMessage: DELETE_IMPACT_FAILED,
      },
    ),
  );
}

export async function deleteAdminRequest(
  requestId: string,
  reason: string,
): Promise<AdminEnrollmentDeletionImpact> {
  return deletionImpactFromContract(
    await bffJson("tenant", "DELETE /api/enrollment/admin/requests/{id}/", {
      params: { id: requestId },
      body: { reason },
      errorMessage: "Anmeldung konnte nicht gelöscht werden",
    }),
  );
}

/**
 * Restores a withdrawn request: every withdrawn child goes back to
 * "submitted" — or "waitlisted" when its offering is meanwhile full
 * (`waitlisted_children`) — and withdrawn_at is cleared (#2157). Fails with
 * a coded 409 when the phase is inactive, an active duplicate request
 * exists, or a reject-mode phase's offering is full.
 */
export async function restoreAdminRequest(
  requestId: string,
): Promise<enrollmentContract.AdminRestoreResponse> {
  return bffJson("tenant", "POST /api/enrollment/admin/requests/{id}/restore", {
    params: { id: requestId },
    errorMessage: "Anmeldung konnte nicht wiederhergestellt werden",
  });
}

export async function deleteAdminChild(
  requestId: string,
  childId: string,
  reason: string,
): Promise<AdminEnrollmentDeletionImpact> {
  return deletionImpactFromContract(
    await bffJson(
      "tenant",
      "DELETE /api/enrollment/admin/requests/{id}/children/{childId}",
      {
        params: { id: requestId, childId },
        body: { reason },
        errorMessage: "Kind konnte nicht aus der Anmeldung gelöscht werden",
      },
    ),
  );
}

export async function createLateInvite(
  phaseId: string,
  input: enrollmentContract.AdminCreateLateInviteRequest,
): Promise<enrollmentContract.AdminCreateLateInviteResponse> {
  return bffJson("tenant", "POST /api/enrollment/phases/{id}/late-invites", {
    params: { id: phaseId },
    body: input,
    errorMessage: "Nachzügler-Link konnte nicht erstellt werden",
  });
}

export async function fetchManualEnrollmentBootstrap(
  phaseId: string,
): Promise<PublicEnrollmentBootstrap> {
  return bootstrapFromContract(
    await bffJson(
      "tenant",
      "GET /api/enrollment/phases/{id}/manual-bootstrap",
      {
        params: { id: phaseId },
        errorMessage: "Formularvorlage konnte nicht geladen werden",
      },
    ),
  );
}

export async function createManualApprovedEnrollment(
  phaseId: string,
  input: enrollmentContract.AdminManualApprovedEnrollmentRequest,
): Promise<enrollmentContract.AdminManualApprovedEnrollmentResponse> {
  return bffJson(
    "tenant",
    "POST /api/enrollment/phases/{id}/manual-approved-enrollments",
    {
      params: { id: phaseId },
      body: input,
      errorMessage: "Manuelle Anmeldung konnte nicht freigegeben werden",
    },
  );
}

export async function listStudentEnrollmentRequests(
  studentId: string,
): Promise<AdminRequestSummary[]> {
  const requests = await bffJson(
    "tenant",
    "GET /api/enrollment/admin/students/{studentId}/requests/",
    {
      params: { studentId },
      errorMessage: "Anmeldungen konnten nicht geladen werden",
    },
  );
  return requests.map(requestSummaryFromContract);
}

export async function exportStudentEnrollmentRequests(
  studentId: string,
  format: EnrollmentExportFormat,
): Promise<void> {
  const response = await bffFile(
    "tenant",
    "POST /api/enrollment/admin/students/{studentId}/requests/export",
    {
      params: { studentId },
      body: { format },
      errorMessage: "Export konnte nicht erstellt werden",
    },
  ).catch((error: unknown) =>
    logEnrollmentFailure(error, logger, "enrollment_admin_request_failed"),
  );
  downloadBlob(
    await response.blob(),
    filenameFromDisposition(response) ?? `anmeldungen.${format}`,
  );
}

/** Downloads the proof of the parent's signature of a request (#4786). */
export async function downloadAdminEnrollmentSignatureProof(
  requestId: string,
): Promise<void> {
  const response = await bffFile(
    "tenant",
    "GET /api/enrollment/admin/requests/{id}/signature-proof",
    {
      params: { id: requestId },
      errorMessage: "Nachweis konnte nicht geladen werden",
    },
  );
  downloadBlob(
    await response.blob(),
    filenameFromDisposition(response) ?? "anmeldenachweis.pdf",
  );
}

export async function decideAdminChild(
  requestId: string,
  childId: string,
  status: DecisionStatus,
  reason?: string,
  existingChildChoice?: ExistingChildChoice,
  acceptOfferingChanges?: boolean,
): Promise<AdminRequestChild> {
  return requestChildFromContract(
    await bffJson(
      "tenant",
      "POST /api/enrollment/admin/requests/{id}/children/{childId}/decide",
      {
        params: { id: requestId, childId },
        body: {
          status,
          reason: reason ?? "",
          ...existingChildChoiceFields(existingChildChoice),
          // The office confirmed the offering changes since submission (#6837).
          ...(acceptOfferingChanges === true
            ? { accept_offering_changes: true }
            : {}),
        },
        errorMessage: "Entscheidung konnte nicht gespeichert werden",
      },
    ),
  );
}

/** The corrected child with its effect on the Regeltermine (#5102). */
export type AdminChildOfferingsUpdate = AdminRequestChild & {
  roster_impact?: studentsContract.rosterImpactResponse;
};

export async function updateAdminChildOfferings(
  requestId: string,
  childId: string,
  input: UpdateAdminChildOfferingsInput,
): Promise<AdminChildOfferingsUpdate> {
  const { roster_impact: rosterImpact, ...child } = await bffJson(
    "tenant",
    "PUT /api/enrollment/admin/requests/{id}/children/{childId}/offerings",
    {
      params: { id: requestId, childId },
      body: {
        offerings: input.offerings,
        reason: input.reason,
        complete_withdrawal_confirmed:
          input.completeWithdrawalConfirmed === true,
      },
      errorMessage: "Betreuungsangebote konnten nicht gespeichert werden",
    },
  );
  return { ...requestChildFromContract(child), roster_impact: rosterImpact };
}

export async function correctAdminChildData(
  requestId: string,
  childId: string,
  input: enrollmentContract.AdminChildDataCorrectionRequest,
): Promise<AdminChildDataCorrectionResult> {
  const corrected = adminChangeRequestFromContract(
    await bffJson(
      "tenant",
      "PUT /api/enrollment/admin/requests/{id}/children/{childId}/data-correction",
      {
        params: { id: requestId, childId },
        body: input,
        errorMessage: "Anmeldedaten konnten nicht korrigiert werden",
      },
    ),
  );
  const { request } = corrected;
  if (!request) {
    // The correction answers with its request; without it the page cannot
    // show what was saved.
    throw new ApiError("Anmeldedaten konnten nicht korrigiert werden", 502, {
      code: "general.write_answer_unreadable",
    });
  }
  return { ...corrected, request };
}

export async function listAdminChildOfferingAdjustments(
  requestId: string,
  childId: string,
): Promise<AdminOfferingAdjustment[]> {
  const adjustments = await bffJson(
    "tenant",
    "GET /api/enrollment/admin/requests/{id}/children/{childId}/offering-adjustments",
    {
      params: { id: requestId, childId },
      errorMessage: "Änderungshistorie konnte nicht geladen werden",
    },
  );
  return adjustments.map((adjustment) => ({
    ...adjustment,
    before: snapshots(adjustment.before),
    after: snapshots(adjustment.after),
  }));
}

export interface ListAdminEnrollmentChangeRequestsFilters {
  requestId?: string;
  status?: ChangeRequestStatus;
}

export async function listAdminEnrollmentChangeRequests(
  filters: ListAdminEnrollmentChangeRequestsFilters = {},
): Promise<AdminEnrollmentChangeRequest[]> {
  const requests = await bffJson(
    "tenant",
    "GET /api/enrollment/admin/change-requests/",
    {
      query: {
        request_id: filters.requestId || undefined,
        status: filters.status,
      },
      errorMessage: "Änderungsanfragen konnten nicht geladen werden",
    },
  );
  return requests.map(adminChangeRequestFromContract);
}

export async function getAdminEnrollmentChangeRequest(
  id: string,
): Promise<AdminEnrollmentChangeRequest> {
  return adminChangeRequestFromContract(
    await bffJson("tenant", "GET /api/enrollment/admin/change-requests/{id}/", {
      params: { id },
      errorMessage: "Änderungsanfrage konnte nicht geladen werden",
    }),
  );
}

/**
 * Questions and consent titles of the request's form version (#6142), which
 * name the rows of a change request.
 */
export async function getAdminEnrollmentFormLabels(
  requestId: string,
): Promise<EnrollmentFormLabels> {
  return formLabelsFromContract(
    await bffJson(
      "tenant",
      "GET /api/enrollment/admin/requests/{id}/form-labels",
      {
        params: { id: requestId },
        errorMessage:
          "Fragen des Anmeldeformulars konnten nicht geladen werden",
      },
    ),
  );
}

export async function askEnrollmentChangeRequestQuestion(
  id: string,
  body: string,
): Promise<AdminEnrollmentChangeRequest> {
  return adminChangeRequestFromContract(
    await bffJson(
      "tenant",
      "POST /api/enrollment/admin/change-requests/{id}/question",
      {
        params: { id },
        body: { body },
        errorMessage: "Rückfrage konnte nicht gesendet werden",
      },
    ),
  );
}

export async function approveEnrollmentChangeRequest(
  id: string,
  note: string,
): Promise<AdminEnrollmentChangeRequest> {
  return adminChangeRequestFromContract(
    await bffJson(
      "tenant",
      "POST /api/enrollment/admin/change-requests/{id}/approve",
      {
        params: { id },
        body: { note },
        errorMessage: "Änderungsanfrage konnte nicht freigegeben werden",
      },
    ),
  );
}

export async function rejectEnrollmentChangeRequest(
  id: string,
  note: string,
): Promise<AdminEnrollmentChangeRequest> {
  return adminChangeRequestFromContract(
    await bffJson(
      "tenant",
      "POST /api/enrollment/admin/change-requests/{id}/reject",
      {
        params: { id },
        body: { note },
        errorMessage: "Änderungsanfrage konnte nicht abgelehnt werden",
      },
    ),
  );
}
