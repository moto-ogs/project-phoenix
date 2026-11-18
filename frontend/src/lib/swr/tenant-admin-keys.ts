/**
 * OGS-Portal, Verwaltung: Anmeldungen, Datenverwaltung, Rollen, Statistik, Umfragen.
 * Keys describe the response, not its screen; a family prefix ends in `-`.
 */
export const tenantAdminKeys = {
  /** The signed-in person's own e-mail subscription of one type (#3780). */
  emailSubscription: (type: string) =>
    `email-subscription-${encodeURIComponent(type)}`,
  enrollmentPhaseFamily: "enrollment-phase-detail-",
  /** One enrollment phase (`getPhase`). */
  enrollmentPhase: (id: string) =>
    `enrollment-phase-detail-${encodeURIComponent(id)}`,
  /** One activity of the Datenverwaltung (`createCrudService(activitiesConfig).getOne`). */
  activity: (id: string) => `activity-detail-${encodeURIComponent(id)}`,
  /** The permission catalog of the Datenverwaltung. */
  permissions: () => "database-permissions-list",
  /**
   * Every role of the school (`createCrudService(rolesConfig).getList`),
   * unfiltered: each reader hides what it does not show.
   */
  roles: () => "database-roles-list",
  /** Every child's masked bank details (`fetchPaymentOverview`). */
  paymentOverview: () => "guardian-payment-overview",
  /** Prefix of every role detail. */
  roleFamily: "role-detail-",
  /** One role with its permissions (`createCrudService(rolesConfig).getOne`). */
  role: (id: string) => `role-detail-${encodeURIComponent(id)}`,
  /** The signed-in person's own birthday opt-out (`fetchBirthdayOptOut`, #1542). */
  birthdayOptOut: () => "birthday-opt-out",
  /** The signed-in person's own message count scope (`fetchMessageCountSetting`, #3673). */
  messageCountSetting: () => "message-count-setting",
  /** The signed-in person's notification consent of one portal catalogue. */
  notificationPreferences: (portal: string) =>
    `notification-preferences-${encodeURIComponent(portal)}`,
  /** The signed-in person's passkeys of one login scope (`listPasskeys`). */
  passkeys: (scope: string) => `passkeys-${encodeURIComponent(scope)}`,
  /** The signed-in person's remembered devices of one login scope. */
  trustedDevices: (scope: string) =>
    `trusted-devices-${encodeURIComponent(scope)}`,
  /** The second factor by e-mail code of the signed-in account (#4497, #7051). */
  emailCodeFactor: () => "email-code-factor-status",
  /** The school's login image and whether this account may change it. */
  loginImage: () => "settings-login-image",
  /** The school's contact address, the proposal for enrollment recipients (#7176). */
  schoolContactEmail: () => "settings-school-contact-email",
  /** Schools the signed-in account can switch to (`listAvailableTenants`). */
  availableTenants: () => "account-available-tenants",
  /** Every Schuljahreswechsel of the school (`listGradeTransitions`, #405). */
  gradeTransitions: () => "grade-transitions-list",
  /** The history of one Schuljahreswechsel (`fetchTransitionHistory`). */
  gradeTransitionHistory: (id: string) =>
    `grade-transition-history-${encodeURIComponent(id)}`,
  /** The preview of one Schuljahreswechsel (`previewGradeTransition`). */
  gradeTransitionPreview: (id: string) =>
    `grade-transition-preview-${encodeURIComponent(id)}`,
  /** The school's classes a transition can map (`fetchTransitionClasses`). */
  gradeTransitionClasses: () => "grade-transition-classes",
  /** Suggested class mappings for a new transition (`fetchSuggestedMappings`). */
  gradeTransitionSuggestions: () => "grade-transition-suggestions",
  /** One account's second-factor state at this school (`adminGetMFAState`). */
  accountMfaState: (accountId: string) =>
    `account-mfa-state-${encodeURIComponent(accountId)}`,
  /** Stammdaten-Kataloge (#3114). */
  absenceTypes: () => "database-absence-types",
  categories: () => "database-categories",
  planningTracks: () => "database-planning-tracks",
  shiftTypes: () => "database-shift-types",
  /** Kategorien mit ihrer aktuellen Schichtart (#1837). */
  shiftTypeCategories: () => "database-shift-type-categories",
  /** Every activity of the Datenverwaltung (first 500). */
  activities: () => "database-activities-list",
  /** Every device of the Datenverwaltung (first 500). */
  devices: () => "database-devices-list",
  /** Prefix of every device history (#2321). */
  deviceHistoryFamily: "database-device-history-",
  /** The history of one device (`fetchDeviceHistory`, #2321). */
  deviceHistory: (id: string) =>
    `database-device-history-${encodeURIComponent(id)}`,
  /**
   * Every child of the Datenverwaltung with arrival times and pending
   * withdrawals; the SSE hook refreshes every key containing this name.
   */
  students: () => "database-students-list",
  /** The school's child quota (#3569). */
  studentChildQuota: () => "database-students-child-quota",
  /** The school's groups as select options, shared by the child forms. */
  groupOptions: () => "database-groups-dropdown",
  /** Every survey the school manages (`fetchSurveys`, #4781). */
  surveys: () => "surveys-list",
  /** The surveys the signed-in person still answers (`fetchSurveysToAnswer`). */
  surveysToAnswer: () => "surveys-to-answer",
  /** One survey (`fetchSurvey`). */
  survey: (id: string) => `survey-${id}`,
  /** The evaluation of one survey (`fetchSurveyResults`). */
  surveyResults: (id: string) => `survey-results-${id}`,
  /** Who answered one non-anonymous survey (`fetchSurveyRespondents`). */
  surveyRespondents: (id: string) => `survey-respondents-${id}`,
} as const;
