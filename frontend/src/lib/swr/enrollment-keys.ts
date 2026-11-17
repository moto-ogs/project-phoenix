import { resourceKey } from "./resource-key";

/**
 * Anmeldung in der OGS-Verwaltung: Phasen, Angebote, Anmeldungen, Übernahme, Einladungen.
 * Keys describe the response, not its screen; a family prefix ends in `-`.
 */
export const enrollmentKeys = {
  /**
   * Every enrollment phase of the school (`listPhases`). The Betreuungsplan
   * reads the same key, so both share one cached answer.
   */
  phases: () => "timetable-enrollment-phases",
  /** Prefix of every phase's care offering list. */
  careOfferingsFamily: "care-offerings-",
  /** The care offerings of one phase (`listCareOfferings`). */
  careOfferings: (phaseId: string) =>
    `care-offerings-${encodeURIComponent(phaseId)}`,
  /** Prefix of every phase's booking stats. */
  bookingStatsFamily: "care-offering-booking-stats-",
  /** Booking stats per offering of one phase (`fetchCareOfferingBookingStats`). */
  bookingStats: (phaseId: string) =>
    `care-offering-booking-stats-${encodeURIComponent(phaseId)}`,
  /** What became of the mails of one enrollment request (`getAdminRequestMails`). */
  requestMails: (requestId: string) =>
    `enrollment-request-mails-${encodeURIComponent(requestId)}`,
  /** One enrollment request with its children (`getAdminRequest`). */
  adminRequest: (requestId: string) =>
    `enrollment-request-detail-${encodeURIComponent(requestId)}`,
  /** What deleting a whole request removes (`getAdminRequestDeleteImpact`). */
  requestDeleteImpact: (requestId: string) =>
    `enrollment-request-delete-impact-${encodeURIComponent(requestId)}`,
  /** What deleting one child of a request removes (`getAdminChildDeleteImpact`). */
  childDeleteImpact: (requestId: string, childId: string) =>
    `enrollment-child-delete-impact-${encodeURIComponent(requestId)}-${encodeURIComponent(childId)}`,
  /** Who a rollover of one phase would carry over (`fetchRolloverPreview`). */
  rolloverPreview: (phaseId: string, bumpsGrade: boolean) =>
    `enrollment-rollover-preview-${encodeURIComponent(phaseId)}-${bumpsGrade ? "bump" : "keep"}`,
  /** Rollover entries of one phase that wait for a decision (`listRolloverReview`). */
  rolloverReview: (phaseId: string) =>
    `enrollment-rollover-review-${encodeURIComponent(phaseId)}`,
  /** Parent account requests that wait for the school (`listPendingApprovals`). */
  pendingGuardianApprovals: () => "guardian-pending-approvals",
  /** Staff invitations not yet accepted (`listPendingInvitations`). */
  pendingInvitations: () => "staff-pending-invitations",
  /** Every role of the school as `authService.getRoles` maps it. */
  roles: () => "auth-roles",
  /** One change request of a family with its request (`getAdminEnrollmentChangeRequest`). */
  changeRequest: (changeRequestId: string) =>
    `enrollment-change-request-${encodeURIComponent(changeRequestId)}`,
  /** Field labels of the form one request was sent with (`getAdminEnrollmentFormLabels`). */
  formLabels: (requestId: string) =>
    `enrollment-request-form-labels-${encodeURIComponent(requestId)}`,
  /** Offering corrections of one child of a request (`listAdminChildOfferingAdjustments`). */
  offeringAdjustments: (requestId: string, childId: string) =>
    `enrollment-offering-adjustments-${encodeURIComponent(requestId)}-${encodeURIComponent(childId)}`,
  /** Form, offerings and legal texts of a manual enrollment into one phase (`fetchManualEnrollmentBootstrap`). */
  manualEnrollmentBootstrap: (phaseId: string) =>
    `enrollment-manual-bootstrap-${encodeURIComponent(phaseId)}`,
  /** Every enrollment form template of the school, all versions (`listSchemas`). */
  formSchemas: () => "enrollment-form-schemas",
  /** The school's legal texts for the enrollment form (`fetchPublicLegalTexts`). */
  publicLegalTexts: (tenantSlug: string) =>
    `enrollment-public-legal-texts-${encodeURIComponent(tenantSlug)}`,
  /**
   * Every timetable template of the school (`timetableService.getTemplates`).
   * The Betreuungsplan reads the same key, so both share one cached answer.
   */
  timetableTemplates: () => "timetable-connect-templates",
  /**
   * The care offerings of the listed phases in one list, for counts across
   * phases. Inside the care offering family, so its invalidation reaches it.
   */
  allPhasesCareOfferings: (phaseIds: readonly string[]) =>
    `care-offerings-of-phases-${phaseIds.map(encodeURIComponent).join(",")}`,
  adminRequestsFamily: "enrollment-requests-",
  /** The enrollment requests of the school, or of one phase (`listAdminRequests`). */
  adminRequests: (phaseId?: string) =>
    `enrollment-requests-${phaseId ? encodeURIComponent(phaseId) : "all"}`,
  /** Every change request of the school (`listAdminEnrollmentChangeRequests`). */
  changeRequests: () => "enrollment-change-request-list",
  /** Phase-end hints; a phase change, rollover or review decision reloads them. */
  phaseExpiryWarnings: () => "enrollment-phase-expiry-warnings",
  /** School class options of the phase detail's class roster export. */
  phaseSchoolClasses: () => "enrollment-phase-school-classes",
  /** Response overview of the existing children of a phase (#3379). */
  phaseResponses: (phaseId: string) => `enrollment-phase-responses-${phaseId}`,
  /** Care usage report of a phase for one filter set (`getCareUsageReport`). */
  careUsageReport: (filters: object) =>
    resourceKey("enrollment-care-usage-report-", filters),
} as const;
