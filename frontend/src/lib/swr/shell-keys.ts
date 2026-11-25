/**
 * Keys the tenant shell reads on every route, including the public ones
 * (#5007). Kept apart from portal-keys.ts, which bundles as a whole.
 */
export const announcementKeys = {
  unread: () => "user-announcements-unread",
} as const;

// Shared by the home page, its now strip and the rooms page; the SSE hook
// refreshes it on attendance events.
export const dashboardKeys = {
  analytics: () => "dashboard-analytics",
  supervision: (accountId: string | undefined, refresh = 0) =>
    `active-supervision-dashboard-${refresh}-${accountId}`,
} as const;

// „Aktuelle Aufsicht" without groups:read (#4573): the caller's own planned
// blocks. The SSE consumer invalidates the family on
// supervision, activity and timetable events (#5017).
export const ownSupervisionKeys = {
  family: "active-supervisions-own-",
  day: () => "active-supervisions-own-day",
  plannedNow: () => "active-supervisions-own-planned-now",
} as const;

// Resources of the always-mounted shell hooks: sidebar badges, bell, mode
// and settings. Per-account keys carry the account so a switch never shows
// the previous account's answer.
export const shellResourceKeys = {
  userContext: () => "user-context",
  // The server's Web Push key, the same for every reader of a portal.
  pushPublicKey: (portal: string) => `push-public-key:${portal}`,
  settingsSchema: () => "settings-schema",
  reminders: () => "reminders",
  changeRequestAccess: (accountId: string) =>
    `change-request-access:${accountId}`,
  /** Matched with `includes`; the account follows after a colon. */
  enrollmentsUnreadPrefix: "enrollments-unread-count",
  enrollmentsUnread: (accountId: string) =>
    `enrollments-unread-count:${accountId}`,
  // Sidebar badges (useUnreadCount). The tenant layout seeds them from the
  // server snapshot (ShellCounts) under the same keys.
  messagesUnread: (accountId: string) => `badge-messages-unread:${accountId}`,
  teamChatUnread: (accountId: string) => `badge-team-chat-unread:${accountId}`,
  changeRequestsPending: (accountId: string) =>
    `badge-change-requests-pending:${accountId}`,
  enrollmentRequestsPending: (accountId: string) =>
    `badge-enrollment-requests-pending:${accountId}`,
  careWithdrawalsPending: (accountId: string) =>
    `badge-care-withdrawals-pending:${accountId}`,
  staffAbsencesPending: (accountId: string) =>
    `badge-staff-absences-pending:${accountId}`,
  // The school portal shell. Its session scope (`school:{tenantId}:{id}`)
  // binds them to school and account.
  schoolTeamChatUnread: () => "school-team-chat-unread",
  // Today's notices: the badge counts the pending acknowledgements in the
  // same entry the page and the class-view card show.
  schoolNoticesToday: () => "school-staff-notices-today",
} as const;

// Family prefixes of the shared resource factories, here so the
// always-mounted SSE invalidator carries no key factory.
export const SWR_FAMILIES = {
  rooms: "rooms-",
  groups: "groups-",
  staff: "staff-directory-",
  me: "me-",
} as const;
