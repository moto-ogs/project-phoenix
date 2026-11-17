/**
 * OGS-Portal, große Arbeitslisten: Listen, Gruppenübersicht, Kindersuche, Zeiterfassung.
 * Keys describe the response, not its screen; a family prefix ends in `-`.
 */
export const tenantListKeys = {
  /**
   * Vertretungsübersicht: Gruppen, mögliche Vertretungen, Übergaben und
   * laufende Aufsichten. Dieselbe Antwort liest die Vertretungsseite unter
   * diesem Schlüssel.
   */
  substitutionOverview: () => "substitution-overview",
  /** Anhänge einer Elternmitteilung im Assistenten, mit ihrer Änderbarkeit (#2890). */
  announcementAttachments: (announcementId: string) =>
    `announcement-attachments-${encodeURIComponent(announcementId)}`,
  /** Gerichte einer Speiseplan-Woche ab ihrem Montag (Mitarbeitende). */
  mealPlanWeek: (monday: string) =>
    `meal-plan-week-${encodeURIComponent(monday)}`,
  /** Fragen der Anmeldung, nach deren Antworten die Kinderliste filtert (#6954). */
  enrollmentAnswerFilters: () => "enrollment-answer-filters",
  /** Der kleine Hilfe-Index der Suche (Titel, Frage, Zusammenfassung; #6954). */
  helpSearchIndex: () => "help-search-index",
  /** Die Treffer der Schulsuche (Cmd/Ctrl+K) zu einem Suchtext. */
  schoolSearch: (term: string) => `school-search-${encodeURIComponent(term)}`,
  /** Pausen der eigenen offenen Arbeitszeit. */
  sessionBreaks: (sessionId: string) =>
    `time-tracking-session-breaks-${encodeURIComponent(sessionId)}`,
} as const;
