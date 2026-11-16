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
} as const;
