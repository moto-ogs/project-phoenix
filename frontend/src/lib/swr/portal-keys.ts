import type {
  AccountPageQuery,
  AccountScope,
} from "~/lib/operator/account-pages";
import { encodeMultiValueParam } from "~/lib/multi-value-param";
import { compareIds } from "~/lib/compare-ids";
import {
  SEARCH_STUDENTS_KEY_PREFIX,
  searchStudentsGroupScope,
} from "./search-students-key";
import { previewRow, previewText, type ListPreview } from "./list-preview";
import { resourceKey } from "./resource-key";
import { groupKeys } from "./groups-keys";

import { shellResourceKeys } from "./shell-keys";

const operatorSummaryPrefixes = [
  "operator-school-summaries",
  "operator-organization-summaries",
  "operator-organization-school-summaries-",
] as const;

/** Unscoped family factories. Only the shared hooks turn these into cache keys. */
export const operatorProvisioningKeys = {
  summaryChanges: (key: string): boolean =>
    operatorSummaryPrefixes.some((prefix) => key.startsWith(prefix)),
  personChanges: (key: string): boolean =>
    key.startsWith("operator-school-persons-") ||
    key.startsWith("operator-org-persons-") ||
    operatorSummaryPrefixes.some((prefix) => key.startsWith(prefix)),
  accountFamilies: [
    "operator-all-accounts",
    "operator-school-accounts-",
    "operator-org-accounts-",
    ...operatorSummaryPrefixes,
  ],
  deviceFamilies: [
    "operator-all-devices",
    "operator-device-history-",
    "operator-school-devices-",
    "operator-org-devices-",
    ...operatorSummaryPrefixes,
  ],
  schoolDevices: (id: string | undefined) =>
    `operator-school-devices-${encodeURIComponent(id ?? "")}`,
  orgDevices: (id: string | undefined) =>
    `operator-org-devices-${encodeURIComponent(id ?? "")}`,
  allDevices: () => "operator-all-devices",
  /** The history of one device across its schools (#2321). */
  deviceHistory: (id: string) =>
    `operator-device-history-${encodeURIComponent(id)}`,
  organizations: () => "operator-organizations",
  schoolSummaries: () => "operator-school-summaries",
  schoolRequiredDetails: () => "operator-school-required-details",
  schoolPersons: (id: string | undefined) =>
    `operator-school-persons-${encodeURIComponent(id ?? "")}`,
  accountPage: (scope: AccountScope, query: AccountPageQuery) => {
    const base =
      scope.kind === "all"
        ? "operator-all-accounts"
        : `operator-${scope.kind === "school" ? "school" : "org"}-accounts-${encodeURIComponent(scope.id)}`;
    return `${base}:${query.sort ?? ""}:${query.direction ?? ""}:${encodeURIComponent(query.search ?? "")}`;
  },
  schools: () => "operator-schools",
  organizationSummaries: () => "operator-organization-summaries",
  organizationSchoolSummaries: (id: string | undefined) =>
    `operator-organization-school-summaries-${encodeURIComponent(id ?? "")}`,
  orgPersons: (id: string | undefined) =>
    `operator-org-persons-${encodeURIComponent(id ?? "")}`,
  orgTraegerMembers: (id: string | undefined) =>
    `operator-org-traeger-members-${encodeURIComponent(id ?? "")}`,
  orgTraegerInvitations: (id: string | undefined) =>
    `operator-org-traeger-invitations-${encodeURIComponent(id ?? "")}`,
  schoolPwaUsage: (id: string | undefined) =>
    `operator-school-pwa-usage-${encodeURIComponent(id ?? "")}`,
  orgErasureOrder: (id: string | undefined) =>
    `operator-org-erasure-order-${encodeURIComponent(id ?? "")}`,
  orgBelegRetention: (id: string | undefined) =>
    `operator-org-beleg-retention-${encodeURIComponent(id ?? "")}`,
  orgTraegerSettings: (id: string | undefined) =>
    `operator-org-traeger-settings-${encodeURIComponent(id ?? "")}`,
  provisioningStats: () => "operator-provisioning-stats",
  caterers: () => "operator-caterers",
  unregisteredTags: (
    resolved: "all" | "resolved" | "unresolved",
    organizationId: string,
    schoolId: string,
  ) =>
    `operator-unregistered-tags-${JSON.stringify([resolved, organizationId, schoolId])}`,
} as const;

export const operatorAnnouncementKeys = {
  list: () => "operator-announcements",
  views: (id: string) =>
    `operator-announcement-views-${encodeURIComponent(id)}`,
  stats: (id: string | undefined) =>
    `announcement-stats-${encodeURIComponent(id ?? "")}`,
} as const;

export const operatorInvitationKeys = {
  list: () => "operator-invitations",
} as const;

export const staffMergeKeys = {
  preview: (id: string | undefined) =>
    `operator-staff-person-merges-${encodeURIComponent(id ?? "")}`,
} as const;

export const messageKeys = {
  teamChatPreviewSources: (key: string) => key.startsWith("team-chat-inbox-"),
  teamChatPreview(data: unknown, id: string): ListPreview | undefined {
    // Only identity shown in the inbox, never the last message or unread data.
    const row = previewRow(data, id);
    const name = previewText(
      row?.kind === "group" ? row.group_name : row?.counterpart_name,
    );
    return name ? { id, name } : undefined;
  },
  groupPreview(data: unknown, id: string): ListPreview | undefined {
    const row = previewRow(data, id);
    const name = previewText(row?.title);
    return name ? { id, name } : undefined;
  },
  teamChatThread: (id: string | undefined) =>
    `team-chat-thread-${encodeURIComponent(id ?? "")}`,
  groupMessageTargets: (id: string | undefined) =>
    `group-message-targets-${encodeURIComponent(id ?? "")}`,
  groupMessageAudience: (id: string | undefined, targetId: string) =>
    resourceKey("group-message-audience-", { type: id, targetId }),
  teamChatInbox: (onlyUnread: boolean) =>
    `team-chat-inbox-${encodeURIComponent(String(onlyUnread))}`,
  /** Every filter of the team-chat inbox. */
  teamChatInboxFamily: () => "team-chat-inbox-",
  messagesInbox: (onlyUnread: boolean) =>
    `messages-inbox-${encodeURIComponent(String(onlyUnread))}`,
  /** Every filter of the parent-message inbox. */
  messagesInboxFamily: () => "messages-inbox-",
  /** Neue Nachrichten und offene Anfragen je Kind für die Kinderkachel (#6486). */
  parentAttention: (withMessages: boolean, withRequests: boolean) =>
    `parent-attention-${withMessages ? "m" : ""}${withRequests ? "r" : ""}`,
  groupMessages: () => "group-messages",
  messageThread: (id: string | undefined) =>
    `message-thread-${encodeURIComponent(id ?? "")}`,
  groupMessage: (id: string | undefined) =>
    `group-message-${encodeURIComponent(id ?? "")}`,
  /** What became of the e-mails of a conversation's OGS messages (#7058). */
  messageThreadMails: (id: string | undefined) =>
    `message-thread-mails-${encodeURIComponent(id ?? "")}`,
  groupMessageMails: (id: string | undefined) =>
    `group-message-mails-${encodeURIComponent(id ?? "")}`,
} as const;

/**
 * The per-child cache families the SSE hook invalidates by prefix. Every key
 * of a family starts with its prefix and continues with the child's id.
 */
export const STUDENT_KEY_FAMILIES = {
  detail: "student-detail-",
  carePlanDay: "care-plan-day-",
  carePlanWeek: "care-plan-week-",
  // Also the start of the absence overview's "student-status-days-overview-":
  // a student update refreshes that list too.
  statusDays: "student-status-days-",
  partialAbsences: "student-partial-absences-",
  statusDayOverview: "student-status-days-overview-",
  pickupData: "pickup-data-",
  arrivalData: "arrival-data-",
} as const;

export const studentKeys = {
  search: searchKey,
  schoolClasses: () => "search-student-school-classes",
  statisticsReport: (params: object) =>
    resourceKey("student-statistics-report-", params),
  detail: (id: string) =>
    `${STUDENT_KEY_FAMILIES.detail}${encodeURIComponent(id)}`,
  notes: (id: string) => `student-notes-${encodeURIComponent(id)}`,
  noteActivities: (id: string) =>
    `student-note-activities-${encodeURIComponent(id)}`,
  permanentNotes: (id: string) =>
    `student-permanent-notes-${encodeURIComponent(id)}`,
  /** The reader's notes the team shared and they have not read (#6854). */
  teamNotices: (accountId: string) =>
    `student-note-team-notices:${encodeURIComponent(accountId)}`,
  /** The reader's unseen changed pickup times (#6855). */
  pickupChangeNotices: (accountId: string) =>
    `student-pickup-change-notices:${encodeURIComponent(accountId)}`,
  enrollments: (id: string) => `student-enrollments-${encodeURIComponent(id)}`,
  /** Elternbriefe and Einverständnisse of the child (#4814). */
  parentRecords: (id: string) =>
    `student-parent-records-${encodeURIComponent(id)}`,
  holidayGuest: (id: string) => `holiday-guest:${encodeURIComponent(id)}`,
  carePlanDay: (id: string, date: string) =>
    `${STUDENT_KEY_FAMILIES.carePlanDay}${encodeURIComponent(id)}-${date}`,
  carePlanWeek: (id: string, from: string, to: string) =>
    `${STUDENT_KEY_FAMILIES.carePlanWeek}${encodeURIComponent(id)}-${from}-${to}`,
  statusDays: (id: string, from: string, to: string) =>
    `${STUDENT_KEY_FAMILIES.statusDays}${encodeURIComponent(id)}-${from}-${to}`,
  statusDayOverview: (params: {
    from: string;
    to: string;
    page: number;
    query: string;
    status: string;
    groupId: string;
  }) =>
    `${STUDENT_KEY_FAMILIES.statusDayOverview}${params.from}-${params.to}-${params.page}-${params.query}-${params.status}-${params.groupId}`,
  partialAbsences: (id: string, from: string, to: string) =>
    `${STUDENT_KEY_FAMILIES.partialAbsences}${encodeURIComponent(id)}-${from}-${to}`,
  previewSources: (key: string) =>
    key.startsWith(SEARCH_STUDENTS_KEY_PREFIX) ||
    key.startsWith(groupKeys.liveFamily) ||
    key.startsWith("room-students-") ||
    key.startsWith(STUDENT_KEY_FAMILIES.statusDayOverview) ||
    key.startsWith("student-statistics-report-"),
  preview(data: unknown, id: string): ListPreview | undefined {
    const row = previewRow(data, id);
    if (!row) return undefined;
    const name =
      previewText(row.name) ??
      [
        previewText(row.first_name),
        previewText(row.second_name) ?? previewText(row.last_name),
      ]
        .filter(Boolean)
        .join(" ");
    if (!name) return undefined;
    return {
      id,
      name,
      context:
        [previewText(row.school_class), previewText(row.group_name)]
          .filter(Boolean)
          // Ohne Trennpunkt wie die Statuszeile der Kindseite (#7402).
          .join(", ") || undefined,
    };
  },
  studentThreads: (id: string | undefined) =>
    `student-threads-${encodeURIComponent(id ?? "")}`,
  changeHistory: (id: string) =>
    `student-change-history-${encodeURIComponent(id)}`,
  pickupData: (id: string) =>
    `${STUDENT_KEY_FAMILIES.pickupData}${encodeURIComponent(id)}`,
  name: (id: string) => `student-name-${encodeURIComponent(id)}`,
  documents: (id: string) => `student-documents-${encodeURIComponent(id)}`,
  arrivalData: (id: string) =>
    `${STUDENT_KEY_FAMILIES.arrivalData}${encodeURIComponent(id)}`,
} as const;

export const timetableKeys = {
  // Abwesenheiten, die noch nicht im Plan stehen (#7021). Ein Präfix der
  // Planänderungen (PLAN_CACHE_KEY_PREFIXES), damit jede Schicht- oder
  // Abwesenheitsänderung im Dienstplan die Liste neu lädt.
  absencePlanGaps: "absence-plan-gaps",
  offeringGaps: (periodId: string) =>
    `offering-gaps-${encodeURIComponent(periodId)}`,
  // Schulferien (#5345): der Hinweis und die Liste eines Fensters.
  schoolVacationHints: (today?: string) =>
    today
      ? `timetable-school-vacation-hints-${today}`
      : "timetable-school-vacation-hints",
  schoolVacationsFamily: "school-vacations-",
  schoolVacations: (from: string, to: string) =>
    `${timetableKeys.schoolVacationsFamily}${from}-${to}`,
  bookingLeftovers: (periodId: string) =>
    `booking-leftovers-${encodeURIComponent(periodId)}`,
  bookingLeftoverCount: (periodId: string) =>
    `${timetableKeys.bookingLeftovers(periodId)}-count`,
  // Elternhinweise zu eigenen Schließtagen in Ferienwochen (ADR 0196):
  // Grund, Tage, Stand und eine Zahl, keine Namen.
  holidayClosureNotices: () => "timetable-holiday-closure-notices",
  /** The offering matching the children a Regeltermin plans (#5104). */
  offeringSuggestion: (query: object) =>
    resourceKey("timetable-offering-suggestion-", query),
  /** Doppelte Einplanungen eines Termins an einem Tag (Hinweis im Formular). */
  conflictCheck: (query: object) =>
    resourceKey("timetable-conflict-check-", query),
  /** Dienstplan-Lücken der geplanten Tage eines Termins (Hinweis im Formular). */
  shiftCoverageCheck: (probes: readonly object[]) =>
    resourceKey("timetable-shift-coverage-check-", { probes }),
  /** Die Kinder mehrerer Angebote ohne Doppelte, als Quelle eines Regeltermins. */
  combinedOfferingCounts: (offeringIds: readonly string[], periodId: string) =>
    resourceKey("timetable-combined-offering-counts-", {
      offeringIds,
      periodId,
    }),
} as const;

// School portal (Lehrkräfte).
export const schoolPortalKeys = {
  classDayClasses: () => "class-day-my-classes",
  classDayReport: (schoolClass: string, date: string) =>
    resourceKey("school-class-day-report-", { schoolClass, date }),
  assignedClasses: (date: string) => `school-assigned-classes-${date}`,
  schoolDay: (date: string) => `school-day-${date}`,
  // „Heute anders“ (#7670): der Tag wechselt auch auf offen gelassenen Seiten.
  dayChanges: (date: string) => `school-day-changes-${date}`,
  parentConferences: () => "school-parent-conferences",
  absenceList: (schoolClass: string, from = "", to = "") =>
    `school-absence-list-${schoolClass}-${from}-${to}`,
  // Der Feed der Glocke (#7139): dieselben Einträge wie im Staff-Portal,
  // eigene Route und eigene Schlüssel.
  notificationFeedFirstPage: () => "school-notification-feed-first-page",
  notificationFeedUnread: () => "school-notification-feed-unread",
  parentLetters: () => "school-parent-letters",
  parentLetter: (id: string) => `school-parent-letter-${id}`,
  calendar: (from: string, to: string) => `school-calendar-${from}-${to}`,
  sharedNotes: (schoolClass: string, studentId: string) =>
    `school-shared-notes-${schoolClass}-${studentId}`,
  // Die heutigen Hinweise: Seite, Karte der Klassenansicht und das Badge
  // der Hülle teilen den Eintrag, damit eine Kenntnisnahme alle sofort
  // nachzieht.
  noticesToday: shellResourceKeys.schoolNoticesToday,
  supervisions: (today: string) => `school-supervisions-${today}`,
  supervisionRoster: (id: string) => `school-supervision-roster-${id}`,
  /** The info sheet of one child in a supervision the teacher holds. */
  supervisionStudentSheet: (instanceId: string, studentId: string) =>
    `school-supervision-student-sheet-${encodeURIComponent(instanceId)}-${encodeURIComponent(studentId)}`,
} as const;

export const weekProtocolKeys = {
  list: (groupId?: string | null) =>
    `week-protocols-${encodeURIComponent(groupId ?? "all")}`,
  detail: (id: string) => `week-protocol-${encodeURIComponent(id)}`,
} as const;

export const payrollKeys = {
  status: () => "payroll-status",
  dispatch: () => "payroll-dispatch",
  sftpStatus: () => "payroll-sftp-status",
  rules: () => "payroll-rules",
  targetCoverage: () => "payroll-target-coverage",
} as const;

export const devicePinKeys = {
  status: () => "settings-device-pin-status",
} as const;

export const databaseKeys = {
  counts: () => "database-stats",
  // The SSE hook revalidates every key containing this name.
  calendarPeriods: () => "database-calendar-periods-list",
  /** The choice of one loaded select field of a database form, by resource. */
  formFieldOptions: (resource: string) =>
    `database-form-options-${encodeURIComponent(resource)}`,
} as const;

export const homeLayoutKeys = {
  key: () => "home-layout",
} as const;

/** Cards of the start page. Keys describe the response, not the card. */
export const homeKeys = {
  /**
   * Today's planned blocks without rosters. „Betreuungsplan heute“, „Mein Tag“
   * and the now strip share it; a settings change refreshes it.
   */
  dayFlow: () => "home-day-flow",
  /** Birthdays of the current week, or of the week starting `weekStart`. */
  birthdayOverview: (weekStart?: string | null) =>
    weekStart ? `birthday-overview:${weekStart}` : "birthday-overview",
  staffSummary: () => "home-staff-summary",
  ownGroup: (accountId: string) => `home-own-group:${accountId}`,
  /**
   * „Heute anders“ (#7659): the day's changes as the account may see them.
   * `dayChanges("")` is the prefix the SSE flush matches. `date` is always
   * the displayed Berlin day, so a mounted card gets a fresh key at midnight.
   */
  dayChanges: (accountId: string, date?: string) =>
    date
      ? `home-day-changes:${accountId}:${date}`
      : `home-day-changes:${accountId}`,
} as const;

/**
 * Lists of the request page (#4988): the merged request feed and the care
 * withdrawals, per account, view and everything the sources query. A
 * decision refreshes every view and filter of a list through its family.
 */
export type RequestFeedName = "request-feed" | "care-withdrawal-feed";
export const requestFeedKeys = {
  family: (name: RequestFeedName, accountId: string | undefined) =>
    `${name}:${accountId}:`,
  key: (
    name: RequestFeedName,
    accountId: string | undefined,
    view: "open" | "history",
    parts: readonly unknown[],
  ): string | null =>
    accountId ? `${name}:${accountId}:${view}:${JSON.stringify(parts)}` : null,
} as const;

/** Dateiablage: the folders, the files of one folder and the audience choices. */
export const fileKeys = {
  folders: () => "files-folders",
  folder: (folderId: string) => `files-folder-${folderId}`,
  audience: () => "files-audience",
} as const;

export const schoolSetupKeys = {
  key: () => "school-setup",
} as const;

export const staffOnboardingKeys = {
  key: () => "staff-onboarding",
} as const;

export const operatorBillingKeys = {
  keyDay: () => "operator-billing-key-day",
  counts: () => "operator-billing-key-date-counts",
} as const;

/** Staff announcement lists never seed the relationship-filtered parents portal. */
export const parentAnnouncementKeys = {
  list: () => "parent-announcements-list",
  detail: (id: string) => `parent-announcement-${id}`,
  pollEvaluation: (id: string) =>
    `parent-announcement-poll-evaluation-${encodeURIComponent(id)}`,
  // Serienbriefe (#4813): the placeholders per portal and the children a
  // letter preview can show.
  letterPlaceholders: (base = "ogs") => `parent-letter-placeholders-${base}`,
  letterPreview: (base = "ogs", studentId: string, body: string) =>
    `parent-letter-preview-${base}-${studentId}-${body}`,
  letterPreviewChildren: (scope: string) =>
    `parent-letter-preview-children-${encodeURIComponent(scope)}`,
  /** Activities a parent announcement can target. */
  targetActivities: () => "parent-announcements-activities",
  /** Name-only lookups on the detail page; never cache catalog personnel here. */
  detailGroupNames: () => "groups-announcement-target-names",
  detailActivityNames: () => "parent-announcements-activity-names",
  /** School classes a parent announcement can target. */
  targetClasses: () => "parent-announcements-classes",
  /** Child search by name in the target picker. */
  targetStudentSearch: (search: string) =>
    `parent-announcements-student-search-${search}`,
  preview(data: unknown, id: string) {
    const row = previewRow(data, id);
    const name = previewText(row?.title);
    if (!row || !name) return undefined;
    return {
      id,
      name,
      // List-visible status/type only enable an authenticated request, never UI or rights.
      poll:
        row.response_type === "single_choice" ||
        row.response_type === "multi_choice",
      status: previewText(row.status),
    };
  },
} as const;

export const displayKeys = { list: () => "info-displays" } as const;

/**
 * Benachrichtigungs-Feed der Glocke (#7148): die erste Seite der Hinweise und
 * der Zähler der ungelesenen. Getrennt, weil die Glocke den Zähler immer
 * lädt, die Liste erst beim Öffnen.
 */
export const notificationFeedKeys = {
  firstPage: () => "notification-feed-first-page",
  unreadCount: () => "notification-feed-unread",
} as const;
/** Dokumente, die der Träger für die Schule freigegeben hat (#4692). */
export const schoolTraegerDocumentKeys = {
  list: () => "traeger-documents-school",
} as const;
export const timeTrackingKeys = {
  overviewFamily: "time-tracking-overview-",
  overview: (day: string) => `time-tracking-overview-${day}`,
  periodFamily: "time-tracking-period-",
  period: (view: "week" | "month", start: string) =>
    `time-tracking-period-${view}-${start}`,
  leaveOverviewFamily: "time-tracking-leave-overview-",
  leaveOverview: (year: number) => `time-tracking-leave-overview-${year}`,
  // Eigene Schichten auf „Mein Dienstplan“ (#3821). Beide teilen das Präfix
  // `time-tracking-own-shifts-week-` aus PLAN_CACHE_KEY_PREFIXES und den
  // SSE-Präfixen: eine Planänderung frischt so auch die Suche nach der
  // nächsten Schicht auf (#5639).
  ownShiftsWeek: (from: string, to: string) =>
    `time-tracking-own-shifts-week-${from}-${to}`,
  ownShiftsAhead: (from: string, to: string) =>
    `time-tracking-own-shifts-week-ahead-${from}-${to}`,
  /** Einstellungen der Zeiterfassung der Schule. */
  config: () => "time-tracking-config",
  /** Feiertage und Schließtage im sichtbaren Zeitraum der Tabelle. */
  holidays: (from: string, to: string) =>
    `time-tracking-holidays-${from}-${to}`,
  closingDays: (from: string, to: string) =>
    `time-tracking-closing-days-${from}-${to}`,
  /** Eigene Einsätze von heute auf der Startseite. */
  ownAssignmentsToday: (today: string) =>
    `time-tracking-own-assignments-today-${today}`,
  /** Eigene Tagesprojektion im Zeitraum (#2443). */
  scheduleTargets: (from: string, to: string) =>
    `time-tracking-schedule-targets-${from}-${to}`,
} as const;

/** Exact list identity shared with intent; preserve the SSE group segment. */
function searchKey(params: {
  groupIds: readonly string[];
  search: string;
  schoolClasses: readonly string[];
  roomId: string;
  dayStatus: string;
  date: string;
  isToday: boolean;
  photoState: string;
  bus: string;
  photoConsent: string;
  companions: boolean;
  years: readonly string[];
  pickupStatus: string;
  /** The registration answer filter (#6954); only an active one adds a segment. */
  enrollmentAnswer?: string;
}): string {
  return `${SEARCH_STUDENTS_KEY_PREFIX}${searchStudentsGroupScope(params.groupIds)}-${params.search}-${encodeMultiValueParam([...params.schoolClasses])}-${params.roomId}-${params.dayStatus}-${params.date}-${params.isToday ? "today" : "planning"}-${params.photoState}-${params.bus}-${params.photoConsent}-${params.companions}-${encodeMultiValueParam([...params.years])}-${params.pickupStatus}${params.enrollmentAnswer ? `-a${params.enrollmentAnswer}` : ""}`;
}

const catererOverviewFamily = "caterer-overview-";
const catererDetailFamily = "caterer-orders-";

/** The authenticated scope supplies the account part of each key. */
export const catererKeys = {
  overviewFamily: catererOverviewFamily,
  overview: (from: string, to: string) =>
    resourceKey(catererOverviewFamily, { from, to }),
  detailFamily: catererDetailFamily,
  schoolDetails: (id: string) => `${catererDetailFamily}${id}:`,
  orders: (id: string, grant: string, from: string, to: string) =>
    resourceKey(`${catererDetailFamily}${id}:${grant}:`, { from, to }),
  notificationFeedFirstPage: () => "caterer-notification-feed-first-page",
  notificationFeedUnread: () => "caterer-notification-feed-unread",
} as const;

/**
 * Die Gesundheitsangaben aus der Ferienanmeldung bei einem eigenen Kind der
 * ausrichtenden OGS (#4722) und die Hinweise „Gast aus …“ an den
 * Feriengästen der Listen (#5630).
 */
export const holidayKeys = {
  /**
   * Die Wochen, die die Schule ausrichtet: Seite „Ferienwochen“ und die
   * Markierung in Betreuungs- und Dienstplan teilen sich den Eintrag.
   */
  hostedWeeks: () => "holiday-weeks",
  studentHealth: (studentId: string) =>
    `holiday-student-health:${encodeURIComponent(studentId)}`,
  /** Betreuung, Notfall und Abholung aus der Ferienanmeldung (#6678). */
  studentRegistration: (studentId: string) =>
    `holiday-student-registration:${encodeURIComponent(studentId)}`,
  /** Zuordnung der eigenen Kinder einer Ferienwoche (#6678). */
  ownChildren: (weekId: string) =>
    `holiday-own-children:${encodeURIComponent(weekId)}`,
  /** Die Kinder einer ausgerichteten Ferienwoche. */
  participants: (weekId: string) => `holiday-participants:${weekId}`,
  /** Eigene Kinder in Ferienwochen anderer OGS (#6679). */
  homeSchoolBookings: () => "holiday-home-school-bookings",
  /** Feriengruppen, deren Woche noch nicht begonnen hat (#6680). */
  guestGroupHints: () => "holiday-guest-group-hints",
  /** Die Feriengruppen der Gruppenverwaltung (ADR 0120, Nachtrag 2026-11-11). */
  guestGroups: "holiday-guest-groups",
  /** Je Satz von Feriengästen ein Schlüssel: ein neuer Gast fragt neu. */
  guestBadges: (studentIds: readonly string[]) =>
    `holiday-guest-badges:${[...studentIds].sort(compareIds).join(",")}`,
};
