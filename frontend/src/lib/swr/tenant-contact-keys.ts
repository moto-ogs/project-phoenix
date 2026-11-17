/**
 * OGS-Portal, Kontakt zu Familien: Nachrichten, Elternbriefe, Sorgeberechtigte, Speiseplan.
 * Keys describe the response, not its screen; a family prefix ends in `-`.
 */
export const tenantContactKeys = {
  /** The colleagues the reader may write to in the team chat (#4776). */
  teamChatRecipients: () => "team-chat-recipients",
  /** The children with a guardian who can receive a message (#4362). */
  messageReachableStudents: () => "message-reachable-students",
  /** The guardians of one child a new conversation can reach, per audience (#5200). */
  messageGuardians: (studentId: string, audience: string) =>
    `message-guardians-${encodeURIComponent(studentId)}-${encodeURIComponent(audience)}`,
  /** One parents' care-schedule or pickup request as the OGS sees it (#3135). */
  careRequest: (requestId: string) =>
    `care-request-${encodeURIComponent(requestId)}`,
  /** Read and acknowledgement counts of one announcement, per portal route base. */
  announcementStats: (announcementId: string, apiBase = "ogs") =>
    `announcement-read-stats-${encodeURIComponent(apiBase)}-${encodeURIComponent(announcementId)}`,
  /** The guardians one announcement reached, with their read state. */
  announcementRecipients: (announcementId: string, apiBase = "ogs") =>
    `announcement-recipients-${encodeURIComponent(apiBase)}-${encodeURIComponent(announcementId)}`,
  /** Both channels of one Elternbrief per child and guardian (#2384). */
  letterStatus: (announcementId: string, apiBase = "ogs") =>
    `letter-status-${encodeURIComponent(apiBase)}-${encodeURIComponent(announcementId)}`,
  /** The answers to one Einverständnis per child (#3430). */
  declarationStatus: (announcementId: string, apiBase = "ogs") =>
    `declaration-status-${encodeURIComponent(apiBase)}-${encodeURIComponent(announcementId)}`,
  /** The school's caterer: supply and invitations (ADR 0077). */
  mealCaterer: () => "meal-caterer",
  /** Every week of the meal orders; a registration change refreshes them. */
  mealOrdersFamily: "meal-orders-",
  /** The meal order of the days `from` to `to` (#3873). */
  mealOrders: (from: string, to: string) => `meal-orders-${from}-${to}`,
  /** Every day and week list of the meal participants. */
  mealParticipantsFamily: "meal-participants-",
  /** Who eats on `date`; with `withOthers` also the children who do not. */
  mealParticipantsDay: (date: string, withOthers: boolean) =>
    `meal-participants-day-${date}-${withOthers ? "all" : "eating"}`,
  /** Who eats on each day of the week from `weekStart`. */
  mealParticipantsWeek: (weekStart: string) =>
    `meal-participants-week-${weekStart}`,
  /** Every regular-days answer of one child. */
  childMealScheduleFamily: (studentId: string) =>
    `meal-child-schedule-${encodeURIComponent(studentId)}-`,
  /** A child's regular meal days as of `from` (#3873). */
  childMealSchedule: (studentId: string, from: string) =>
    `meal-child-schedule-${encodeURIComponent(studentId)}-${from}`,
  /** The guardians of one child with their relationship. */
  studentGuardians: (studentId: string) =>
    `student-guardians-${encodeURIComponent(studentId)}`,
  /** What became of the e-mails to each guardian of one child. */
  studentGuardianEmailStates: (studentId: string) =>
    `student-guardian-email-states-${encodeURIComponent(studentId)}`,
  /** One guardian's masked bank details (#2608); the full IBAN is never cached. */
  guardianPayment: (guardianId: string) =>
    `guardian-payment-${encodeURIComponent(guardianId)}`,
} as const;
