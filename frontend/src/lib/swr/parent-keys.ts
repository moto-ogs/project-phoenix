import type { Child } from "~/lib/parent-api";

function relationships(children: readonly Child[]): string {
  return children
    .map(
      (child) =>
        `${encodeURIComponent(child.tenant_id)}:${encodeURIComponent(child.student_id)}`,
    )
    .sort()
    .join(",");
}

const GROUP_THREAD_FAMILY = "parent-group-thread-";
const CHILD_THREADS_FAMILY = "parent-child-threads-";

/**
 * Keys of the parents portal shell (#5007). Kept apart from portal-keys.ts,
 * which bundles as a whole, so the parents' and the public enrollment
 * routes do not carry every portal's factories.
 */
export const parentKeys = {
  mealParticipationFamily: (schoolId: string, studentId: string) =>
    `parent-meal-participation-${encodeURIComponent(schoolId)}-${encodeURIComponent(studentId)}-`,
  mealParticipation: (
    schoolId: string,
    studentId: string,
    from: string,
    to: string,
    asOf: string,
  ) =>
    `parent-meal-participation-${encodeURIComponent(schoolId)}-${encodeURIComponent(studentId)}-${from}-${to}-${asOf}`,

  shellChildren: () => "parent-shell-children",
  // Badges of the parents shell (useUnreadCount).
  messagesUnreadCount: () => "parent-messages-unread-count",
  newsUnreadCount: () => "parent-news-unread-count",
  // Die Glocke (#7140): Zähler und erste Seite der Hinweise des Kontos.
  notificationFeed: {
    firstPage: () => "parent-notification-feed-first-page",
    unreadCount: () => "parent-notification-feed-unread",
  },
  isChildResource: (key: string) =>
    key === "parent-shell-children" ||
    key.startsWith("parent-features-") ||
    key.startsWith("parent-today-"),
  /**
   * What a staff decision or a parent write on a child changes besides the
   * shared child resources: its care state and offerings, its courses and
   * the history of its requests. Without a child, that of every child.
   */
  isChildStatusResource: (key: string, studentId?: string | null) => {
    if (!studentId)
      return /^parent-child-.+?-(?:status-|courses$|request-events-)/.test(key);
    const child = `parent-child-${encodeURIComponent(studentId)}-`;
    return (
      key.startsWith(`${child}status-`) ||
      key === `${child}courses` ||
      key.startsWith(`${child}request-events-`)
    );
  },
  /** Prefixes of `parentInboxKeys.groupThread` / `childThreads`. */
  groupThreadFamily: GROUP_THREAD_FAMILY,
  childThreadsFamily: CHILD_THREADS_FAMILY,
  /**
   * What the unread refresh reloads. A conversation or group thread stays
   * out: reading it marks it read, so a refresh would mark a message read
   * in a hidden tab, and its reader's badge nudge fires this refresh again.
   * Those readers read anew on every opening instead.
   */
  isMessagesResource: (key: string) =>
    key === "parent-messages" ||
    key === "parent-group-threads" ||
    key.startsWith(CHILD_THREADS_FAMILY),
  isNewsResource: (key: string) => key === "parent-announcements",
  isResource: (key: string) =>
    key.startsWith("parent-") && !key.startsWith("parent-profile"),
  relationshipSet: (children: readonly Child[]) => relationships(children),
  features: (children: readonly Child[], day: string) =>
    `parent-features-${relationships(children)}-${day}`,
  today: (children: readonly Child[], day: string) =>
    `parent-today-${relationships(children)}-${day}`,
  /** Appointments from `day` over `days` days; the start page reads 90. */
  calendar: (day: string, days = 90) => `parent-calendar-${day}-${days}`,
  calendarFamily: "parent-calendar-",
  /** Response counts of one invitation, per date of a series (#6846, #6987). */
  appointmentOverviewFamily: "parent-appointment-overview-",
  appointmentOverview: (appointmentId: string, occurrenceDate?: string) =>
    `parent-appointment-overview-${encodeURIComponent(appointmentId)}-${occurrenceDate ?? ""}`,
  /**
   * The child's care state that `parent-conversation-refresh` (a staff
   * decision, a parent write) refreshes. Absences, requests and plan are
   * resolved against the Berlin `day`, so a tab open across midnight reads
   * them again (#1725).
   */
  sickDays: (studentId: string, day: string) =>
    `parent-child-${encodeURIComponent(studentId)}-status-sick-days-${day}`,
  excusedRequests: (studentId: string, day: string) =>
    `parent-child-${encodeURIComponent(studentId)}-status-excused-requests-${day}`,
  careExceptions: (studentId: string, day: string) =>
    `parent-child-${encodeURIComponent(studentId)}-status-care-exceptions-${day}`,
  pickupChangeRequests: (studentId: string, day: string) =>
    `parent-child-${encodeURIComponent(studentId)}-status-pickup-change-requests-${day}`,
  careSchedule: (studentId: string, day: string) =>
    `parent-child-${encodeURIComponent(studentId)}-status-care-schedule-${day}`,
  careOfferings: (studentId: string) =>
    `parent-child-${encodeURIComponent(studentId)}-status-care-offerings`,
  masterData: (studentId: string) =>
    `parent-child-${encodeURIComponent(studentId)}-master-data`,
  /** The offerings a change request can choose, as of `date` (today when absent). */
  offeringCatalog: (studentId: string, date?: string) =>
    `parent-child-${encodeURIComponent(studentId)}-offering-catalog-${date ?? ""}`,
  guardians: (studentId: string) =>
    `parent-child-${encodeURIComponent(studentId)}-guardians`,
  relatedAccounts: (studentId: string) =>
    `parent-child-${encodeURIComponent(studentId)}-related-accounts`,
  pickupPermissionRequests: (studentId: string) =>
    `parent-child-${encodeURIComponent(studentId)}-pickup-permission-requests`,
  /** The declaration text for one set of signature inputs (#4780). */
  pickupSignatureStatement: (studentId: string, input: string) =>
    `parent-child-${encodeURIComponent(studentId)}-pickup-signature-statement-${encodeURIComponent(input)}`,
  consents: (studentId: string) =>
    `parent-child-${encodeURIComponent(studentId)}-consents`,
  courses: (studentId: string) =>
    `parent-child-${encodeURIComponent(studentId)}-courses`,
  conferences: (studentId: string) =>
    `parent-child-${encodeURIComponent(studentId)}-conferences`,
  /** The guardians a new request of this child may be shared with. */
  sharingOptions: (studentId: string) =>
    `parent-child-${encodeURIComponent(studentId)}-sharing-options`,
  requestSharing: (studentId: string, requestType: string, requestId: string) =>
    `parent-child-${encodeURIComponent(studentId)}-request-sharing-${encodeURIComponent(requestType)}-${encodeURIComponent(requestId)}`,
  /** The change history of one request; its last entry is the version. */
  requestEventsFamily: (studentId: string) =>
    `parent-child-${encodeURIComponent(studentId)}-request-events-`,
  requestEvents: (studentId: string, requestType: string, requestId: string) =>
    `parent-child-${encodeURIComponent(studentId)}-request-events-${encodeURIComponent(requestType)}-${encodeURIComponent(requestId)}`,
  messages: () => "parent-messages",
  groupThreads: () => "parent-group-threads",
  announcements: () => "parent-announcements",
  /** The holiday periods the start page announces (#6671). */
  holidayOffers: () => "parent-holiday-offers",
  /** The holiday registrations linked to the account (#6673). */
  holidayRegistrationEntries: () => "parent-holiday-registration-entries",
  profile: () => "parent-profile",
  /** The conversation of one child with one audience (#5011, #5200). */
  /** Prefix of every conversation (each audience) of one child. */
  conversationFamily: (studentId: string) =>
    `parent-conversation-${encodeURIComponent(studentId)}-`,
  conversation: (studentId: string, audience: string) =>
    `parent-conversation-${encodeURIComponent(studentId)}-${encodeURIComponent(audience)}`,
} as const;
