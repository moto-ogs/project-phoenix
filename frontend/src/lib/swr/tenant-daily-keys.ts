import { resourceKey } from "./resource-key";

/**
 * OGS-Portal, Tagesbetrieb: Kalender, Start, Speiseplan, Nachrichten, Zeiterfassung.
 * Keys describe the response, not its screen; a family prefix ends in `-`.
 */
export const tenantDailyKeys = {
  /** Springer des Trägers mit den Blockungen einer Woche (#4709). */
  springerWeek: (monday: string) =>
    `school-staff-pool-week-${encodeURIComponent(monday)}`,
  /** Antworten aus der Anmeldung eines Kindes (#2517). */
  studentEnrollmentExtraFields: (studentId: string) =>
    `student-enrollment-extra-fields-${encodeURIComponent(studentId)}`,
  /** Mensa-Monate der Freigabe mit ihrem Stand (#4686). */
  mealBillingMonths: () => "meal-billing-months",
  mealBillingMonth: (month: string) =>
    `meal-billing-month-${encodeURIComponent(month)}`,
  /** Kategorien der Aktivitäten, die Auswahl im Aktivitätsformular. */
  activityCategories: () => "activity-categories",
  /**
   * Wer an einem Regeltermin je Wochentag dazukommt und wegfällt, wenn er
   * seine Kinder aus Angeboten nimmt (#5103); als Entwurf gegen die vorher
   * geplante Liste (#5104).
   */
  offeringPreview: (
    templateId: string,
    selection: object,
    from: string | undefined,
  ) => resourceKey("offering-preview-", { templateId, selection, from }),
  draftOfferingPreview: (
    periodId: string,
    selection: object,
    roster: object,
    from: string | undefined,
    template: object | undefined,
  ) =>
    resourceKey("draft-offering-preview-", {
      periodId,
      selection,
      roster,
      from,
      template,
    }),
  /** Was aus den E-Mails eines Termins an die Eltern wurde (#7058). */
  appointmentMails: (appointmentId: string) =>
    `calendar-appointment-mails-${encodeURIComponent(appointmentId)}`,
  /**
   * Heute beendete und abgelaufene Blöcke (#2335). Das Präfix „timetable-“
   * lässt jedes Planereignis die Liste neu laden.
   */
  pastBlocks: () => "timetable-planned-past",
  /**
   * Die Kinderliste eines Blocks; derselbe Schlüssel wie in
   * `activeSupervisionRosterKey`, den das SSE als „timetable-roster-“ auffrischt.
   */
  timetableRoster: (instanceId: string) =>
    `timetable-roster-${encodeURIComponent(instanceId)}`,
  /** Die laufende Aufsicht eines Raums mit ihren Betreuenden (#4763). */
  runningSupervision: (activeGroupId: string) =>
    `running-supervision-${encodeURIComponent(activeGroupId)}`,
  /** Die aktiven Betreuungsangebote der Schule, die als Betreuung zählen (#4571). */
  careOfferingOptions: () => "student-care-offering-options",
  /**
   * Die anwesenden Kinder mit Gehzeit (#3824), alle („present“) oder die
   * eines Betreuungsangebots (#4571).
   */
  presentChildren: (source: string) =>
    `present-children-${encodeURIComponent(source)}`,
  /** Alle Aktivitäten der Schule (`activityService.getActivities()`). */
  activities: () => "activity-groups-all",
  /**
   * Alle Räume des Planers (`fetchPlannerRooms`). Derselbe Schlüssel wie der
   * Raumfilter des Betreuungsplans: eine Antwort, ein Name.
   */
  plannerRooms: () => "timetable-filter-rooms",
  /** Die Betreuenden einer laufenden Aufsicht (Schulhof-Banner). */
  activeGroupSupervisors: (activeGroupId: string) =>
    `active-group-supervisors-${encodeURIComponent(activeGroupId)}`,
  /** Was einen Raum noch hält, bevor er entfernt wird (#6845). */
  roomRemovalImpact: (roomId: string) =>
    `room-removal-impact-${encodeURIComponent(roomId)}`,
  /** Soll und Ist (#4774): Kinder mit Überschreitungen im Zeitraum. */
  careTimeOverruns: (
    from: string,
    to: string,
    groupIds: readonly string[],
    schoolClasses: readonly string[],
  ) =>
    resourceKey("care-time-overruns-", { from, to, groupIds, schoolClasses }),
  /**
   * Der Fragebogen einer Umfrage (#4781): für das Team je Umfrage, für Eltern
   * je Mitteilung und ihrem Veröffentlichungsstand. Das Elternportal liest
   * ihn unter seinem eigenen Sitzungsbereich.
   */
  surveyForm: (respondent: "parent" | "staff", id: string, version = "") =>
    `${respondent}-survey-form-${encodeURIComponent(id)}-${encodeURIComponent(version)}`,
  /**
   * Wie viele Termine „Termine absagen“ im Zeitraum absagen würde (#3594,
   * dry_run). Das Präfix „timetable-“ zählt nach jedem Planereignis neu.
   */
  bulkCancelPreviewFamily: "timetable-bulk-cancel-preview-",
  bulkCancelPreview: (from: string, to: string, includeSeries: boolean) =>
    resourceKey("timetable-bulk-cancel-preview-", { from, to, includeSeries }),
  /**
   * Die Betreuungsangebote eines Planungszeitraums als Quelle eines
   * Regeltermins (#5103); ohne Zeitraum die des laufenden.
   */
  offeringSources: (periodId: string) =>
    `timetable-offering-sources-${encodeURIComponent(periodId)}`,
  /** Wen eine Nachricht zur Absage eines Termins erreicht (#2601). */
  guardianNoticeReach: (instanceId: string) =>
    `timetable-guardian-notice-reach-${encodeURIComponent(instanceId)}`,
  /** Aktivitäten, Kategorien und eigenes Personalprofil der Seite „Aktivitäten“. */
  activitiesOverview: () => "activities-page",
  /** Termine des Team-Kalenders je Ansicht und Zeitraum. */
  staffCalendar: (viewMode: string, from: string, to: string) =>
    `staff-calendar-${viewMode}-${from}-${to}`,
  /**
   * Gesetzliche Feiertage des Bundeslands im Zeitraum (#4775); Kalender und
   * Liste der Schulferien teilen die Antwort.
   */
  schoolHolidays: (from: string, to: string) => `school-holidays-${from}-${to}`,
  /** Empfänger, die ein Termin erreichen kann, je Suche. */
  calendarRecipientOptions: (search: string) =>
    `calendar-recipient-options-${search}`,
  /**
   * Geburtstage (#1542): ohne Woche die Übersicht der Startseite, mit Woche
   * die des Startseiten-Bausteins.
   */
  birthdayOverview: (weekStart?: string) =>
    weekStart ? `birthday-overview:${weekStart}` : "birthday-overview",
  /**
   * Ob die eigene Prüfzuständigkeit für Elternanfragen dieses Kind erreicht
   * (#3886), je Konto.
   */
  requestReviewCoverage: (accountId: string, studentId: string) =>
    `request-review-coverage:${accountId}:${studentId}`,
} as const;
