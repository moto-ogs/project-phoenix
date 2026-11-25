import { planFilterKey, type PlanFilter } from "~/lib/plan-filter";
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
  /**
   * Ein eigener Termin, wie ihn das Ändern-Formular liest und speichert
   * (ADR 0311): mit seiner Version.
   */
  staffAppointmentDetail: (appointmentId: string) =>
    `staff-appointment-detail-${encodeURIComponent(appointmentId)}`,
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
  /** Die Betreuenden einer laufenden Aufsicht. */
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
  /**
   * Die Kinderliste der gewählten Aufsicht: nach Termin, sonst nach laufender
   * Gruppe. Ohne Raum oder für eine Gruppe ohne Termin (404) kein Schlüssel.
   */
  activeSupervisionRoster: (options: {
    readonly selectedTimetableInstanceId: string | null;
    readonly currentRoomId: string | null | undefined;
    readonly missingRosterActiveGroupIds: ReadonlySet<string>;
  }): string | null => {
    if (options.selectedTimetableInstanceId) {
      return `timetable-roster-${options.selectedTimetableInstanceId}`;
    }
    if (
      !options.currentRoomId ||
      options.missingRosterActiveGroupIds.has(options.currentRoomId)
    ) {
      return null;
    }
    return `timetable-roster-active-group-${options.currentRoomId}`;
  },
  /** Gesetzliche Feiertage im Fenster; Liste und Kalender teilen sie. */
  schoolHolidays: (from: string, to: string) => `school-holidays-${from}-${to}`,
  /**
   * Die Termine des Betreuungsplans je Ansicht, Fenster und Filter; das
   * Präfix „timetable-“ lässt jedes Planereignis sie neu laden.
   */
  planInstances: (view: string, from: string, to: string, filter: PlanFilter) =>
    `timetable-${view}-${from}-${to}${planFilterKey(filter)}`,
  /** Die volle Fassung eines Tages für das Detailpanel. */
  planInstanceDetail: (
    view: string,
    from: string,
    to: string,
    filter: PlanFilter,
    date: string,
  ): string =>
    `${tenantDailyKeys.planInstances(view, from, to, filter)}-detail-${date}`,
  /** Lücken der Planung im Fenster (höchstens 14 Tage). */
  planGaps: (from: string, to: string) => `timetable-gaps-${from}-${to}`,
  /** Namen der Planpersonen ohne users:read (#3817). */
  planStaffNames: (from: string, to: string) =>
    `timetable-plan-staff-names-${from}-${to}`,
  /** Name und ID aller Kinder für den Plan (#4996). */
  planStudents: () => "timetable-student-list",
  /** Gruppen des Gruppenfilters. */
  plannerGroups: () => "timetable-filter-groups",
  /**
   * Kategorien des Terminformulars (`fetchPlannerActivityCategories`). Die
   * Rohantwort des Endpunkts, nicht die Abbildung von `activityCategories`.
   */
  plannerCategories: () => "planner-activity-categories",
  /** Alle Kinder als Auswahl des Terminformulars (`fetchAllStudentOptions`). */
  plannerStudentOptions: () => "planner-student-options",
  /** Bestätigte Konflikte des Plans. */
  conflictAcks: () => "timetable-conflict-acks",
  /** Regeltermine eines Planungszeitraums. */
  templates: (periodId: string) => `timetable-templates-${periodId}`,
  /** Regeltermin mit Listenpflege für das Detail eines Serientermins. */
  templateRosterMaintenance: (templateId: string, periodId: string) =>
    `timetable-template-roster-maintenance-${templateId}-${periodId}`,
  /** Teilnehmende eines Termins. */
  instanceParticipants: (instanceId: string) =>
    `timetable-participants-${instanceId}`,
  /** Wer einen Termin vertreten kann. */
  staffPool: (instanceId: string) => `timetable-staff-pool-${instanceId}`,
  /** Termine des Zeitraums für die Sammel-Vertretung. */
  bulkSubstitutionRange: (from: string, to: string) =>
    `timetable-sammel-vertretung-${from}-${to}`,
  /**
   * Verlauf der Abweichungen eines Tages, für einen Block (Gruppe und Beginn)
   * oder den ganzen Tag.
   */
  deviationHistory: (
    date: string,
    slot: { activityGroupId: string; startTime: string } | null,
  ) =>
    `deviation-history-${date}-${slot ? `${slot.activityGroupId}-${slot.startTime}` : "day"}`,
  /** Der Tagesplan eines Tages. */
  dayPlan: (day: string) => `tagesplan-${day}`,
  /**
   * Regeltermine, deren Kinderliste von den Buchungen abweicht (#5103); ein
   * Deep-Link liest unter eigenem Schlüssel frisch.
   */
  rosterDeviations: (periodId: string, freshReadID?: string | null) =>
    `roster-deviations-${periodId}${freshReadID ? `-connect-${freshReadID}` : ""}`,
  rosterDeviationCount: (periodId: string) =>
    `${tenantDailyKeys.rosterDeviations(periodId)}-count`,
  /** Vertretungsansicht: Termine, Lücken und Personal einer Woche. */
  vertretungWeekFamily: "vertretung-week-",
  vertretungWeek: (from: string, to: string): string =>
    `${tenantDailyKeys.vertretungWeekFamily}${from}-${to}`,
  vertretungGapsFamily: "vertretung-gaps-",
  vertretungGaps: (from: string, to: string): string =>
    `${tenantDailyKeys.vertretungGapsFamily}${from}-${to}`,
  vertretungStaffList: (from: string, to: string) =>
    `vertretung-staff-list-${from}-${to}`,
  /**
   * Dienstplan: Übersicht (Mo–Fr-Fenster) und rohe Schichten (volle Woche).
   * Die Präfixe stehen in PLAN_CACHE_KEY_PREFIXES.
   */
  dienstplanOverview: (from: string, to: string) =>
    `dienstplan-overview-${from}-${to}`,
  dienstplanShifts: (from: string, to: string) =>
    `dienstplan-shifts-${from}-${to}`,
  /** Alle Dienstarten, auch entfernte (#6845). */
  shiftTypes: () => "dienstplan-shift-types",
  /** Offene Entscheidungen über verlängerte Abholzeiten. */
  pickupExtensions: () => "pickup-extensions",
  /** Aktivitäten, Kategorien und eigenes Personalprofil der Seite „Aktivitäten“. */
  activitiesOverview: () => "activities-page",
  /** Alle Ansichten und Zeiträume des Team-Kalenders (#7693). */
  staffCalendarFamily: "staff-calendar-",
  /** Termine des Team-Kalenders je Ansicht und Zeitraum. */
  staffCalendar: (viewMode: string, from: string, to: string) =>
    `${tenantDailyKeys.staffCalendarFamily}${viewMode}-${from}-${to}`,
  /** Empfänger, die ein Termin erreichen kann, je Suche. */
  calendarRecipientOptions: (search: string) =>
    `calendar-recipient-options-${search}`,
  /**
   * Ob die eigene Prüfzuständigkeit für Elternanfragen dieses Kind erreicht
   * (#3886), je Konto.
   */
  requestReviewCoverage: (accountId: string, studentId: string) =>
    `request-review-coverage:${accountId}:${studentId}`,
  /** Angebote und Abholzeiten eines Tages für die Tageslisten (`fetchSlotListOptions`). */
  slotListOptions: (date: string) =>
    `timetable-slot-list-options-${encodeURIComponent(date)}`,
  /** Vorschau einer Tagesliste für genau diese Anfrage (`fetchSlotListPreview`). */
  slotListPreview: (request: object) =>
    resourceKey("timetable-slot-list-preview-", request),
} as const;
