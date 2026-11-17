/**
 * OGS-Portal, Kinder: Akten-Unterseiten, Listen, Importe, Gruppen- und Raumseiten.
 * Keys describe the response, not its screen; a family prefix ends in `-`.
 */
import { resourceKey } from "./resource-key";

export const tenantStudentKeys = {
  /**
   * One page of the school's children for these filters (`fetchStudents`),
   * e.g. a picker's name search or a choice list's page. Filtering out
   * children a screen already shows stays outside the cache.
   */
  studentPage: (filters: object) => resourceKey("student-page-", filters),
  /**
   * Every child of the school as a sorted choice list (all pages), per
   * opening scope (a supervision block): a block switch reads it anew.
   */
  studentChoices: (scope: string) =>
    `student-choices-${encodeURIComponent(scope)}`,
  /** The open care withdrawal of one child (`fetchStudentCareWithdrawal`). */
  careWithdrawal: (studentId: string) =>
    `student-care-withdrawal-${encodeURIComponent(studentId)}`,
  /** One child's feedback entries (`fetchStudentFeedback`). */
  feedback: (studentId: string) =>
    `student-feedback-${encodeURIComponent(studentId)}`,
  /** One child's attendance protocol (`fetchStudentAttendanceHistory`). */
  attendanceHistory: (studentId: string) =>
    `student-attendance-history-${encodeURIComponent(studentId)}`,
  /** The day evaluation of one Berlin day (`fetchDayLog`). */
  dayLog: (date: string) => `day-log-${date}`,
  /**
   * One child's arrival plan for a week (`fetchArrivalData` with a range).
   * Deliberately outside `studentKeys.arrivalData`'s SSE prefix: the care
   * schedule editor refreshes it on `CARE_SCHEDULE_STALE_EVENT`, deferred
   * while a draft is open.
   */
  arrivalWeek: (studentId: string, from: string, to: string) =>
    `care-week-arrival-${encodeURIComponent(studentId)}-${from}-${to}`,
  /** The pickup counterpart (`fetchStudentPickupData` with a range). */
  pickupWeek: (studentId: string, from: string, to: string) =>
    `care-week-pickup-${encodeURIComponent(studentId)}-${from}-${to}`,
  /** The school's arrival settings: care days source, periods, defaults (`fetchArrivalSettings`). */
  arrivalSettings: () => "arrival-settings",
  /** Whether the reader has an RSS link for new parent requests (`getRequestFeedStatus`). */
  requestFeedStatus: () => "request-feed-status",
  /** The dry run of a parent-portal invitation for these children (`bulkInviteGuardians`). */
  bulkInvitePreview: (studentIds: readonly string[], resendOpen: boolean) =>
    `bulk-invite-preview-${resendOpen ? "resend" : "new"}-${encodeURIComponent([...studentIds].sort().join(","))}`,
  /** What deleting one child would remove (`fetchStudentDeletionImpact`). */
  deletionImpact: (studentId: string, completionId?: string) =>
    `student-deletion-impact-${encodeURIComponent(studentId)}-${encodeURIComponent(completionId ?? "")}`,
  /** One child's Laufgemeinschaft (`fetchStudentCompanions`). */
  companions: (studentId: string) =>
    `student-companions-${encodeURIComponent(studentId)}`,
  /** One child's stored privacy consent and retention (`fetchStudentPrivacyConsent`). */
  privacyConsent: (studentId: string) =>
    `student-privacy-consent-${encodeURIComponent(studentId)}`,
  /** Whether one child's family protection is on (`getFamilyProtection`). */
  familyProtection: (studentId: string) =>
    `student-family-protection-${encodeURIComponent(studentId)}`,
  /** The school's consent and retention defaults for a new child (`fetchPrivacyConsentDefaults`). */
  privacyConsentDefaults: () => "privacy-consent-defaults",
  /** A school class's Unterrichtsschluss per weekday (`fetchClassArrivalTimes`). */
  classArrivalTimes: (schoolClass: string) =>
    `class-arrival-times-${encodeURIComponent(schoolClass)}`,
  /**
   * A class's day-specific arrival times (`ClassArrivalExceptionApi.list`):
   * OGS portal and school portal answer under their own session scope.
   */
  classArrivalExceptions: (schoolClass: string) =>
    `class-arrival-exceptions-${encodeURIComponent(schoolClass)}`,
  /** How many of these children have own arrival times (`fetchBulkArrivalScheduleStatus`). */
  arrivalScheduleCollisions: (studentIds: readonly string[]) =>
    `arrival-schedule-collisions-${encodeURIComponent([...studentIds].sort().join(","))}`,
  /** Booked vs. actual care time of one child in a range (`fetchStudentCareTimes`). */
  careTimes: (studentId: string, from: string, to: string) =>
    `student-care-times-${encodeURIComponent(studentId)}-${from}-${to}`,
  /** The correction trail of one child's closed block (`fetchAttendanceCorrections`). */
  attendanceCorrections: (instanceId: string, studentId: string) =>
    `attendance-corrections-${encodeURIComponent(instanceId)}-${encodeURIComponent(studentId)}`,
} as const;
