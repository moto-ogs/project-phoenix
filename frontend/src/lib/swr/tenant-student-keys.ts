/**
 * OGS-Portal, Kinder: Akten-Unterseiten, Listen, Importe, Gruppen- und Raumseiten.
 * Keys describe the response, not its screen; a family prefix ends in `-`.
 */
export const tenantStudentKeys = {
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
  /** Die Einträge der Klassenliste (`fetchClassListEntries`). */
  classListEntries: () => "class-list-entries",
  /** Klassen, die die Klassenliste vorschlägt (`fetchClassSuggestions`). */
  classListClassSuggestions: () => "class-list-class-suggestions",
  /** Die angelegten Kinder neben der Klassenliste (`fetchRosterStudents`). */
  classListRosterStudents: () => "class-list-roster-students",
  /** Prefix of every page of ended care (`fetchEndedCare`). */
  endedCareFamily: "students-ended-care",
  /** One page of ended care for one search. */
  endedCare: (page: number, search: string) =>
    `students-ended-care:${page}:${search}`,
  /**
   * Today's Mensa/HA tracking indicators of these children; the SSE hook
   * refreshes every key containing "tracking-indicators-".
   */
  trackingIndicators: (studentIdsKey: string) =>
    `tracking-indicators-${studentIdsKey}`,
} as const;
