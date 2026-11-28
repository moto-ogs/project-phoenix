import type { MotoConcept } from "~/lib/moto-concepts";

type ConceptLoader = () => Promise<MotoConcept>;

/**
 * Das Konzept-Symbol jeder Einstellungs-Kategorie (#8221, Spec #8220), Schlüssel
 * für Schlüssel neben `categoryLabels` in `settings-filter.ts`. Die Karte
 * einer Kategorie zeigt es nur, wenn ihre Ansicht nach der Themenkarten-Regel
 * (`.claude/rules/frontend-ui-kit.md`, Kartenkopf) mehrere Themenkarten hat;
 * das entscheidet der Aufrufer über `withIcon` an `SettingsCategory`.
 * Wer eine Kategorie-Bezeichnung anlegt, trägt hier ihr Konzept ein, sonst
 * schlägt `settings-category-concepts.test.ts` fehl. Jeder Eintrag lädt nur
 * sein eigenes Symbol, damit eine Themenkarte keine Glyphen anderer
 * Kategorien mitbringt.
 */
export const CATEGORY_CONCEPTS: Readonly<Record<string, ConceptLoader>> = {
  abholung: () => import("~/lib/concepts/pickup").then((m) => m.pickupConcept),
  abwesenheit: () =>
    import("~/lib/concepts/absences").then((m) => m.absencesConcept),
  aktivierung: () =>
    import("~/lib/concepts/enrollments").then((m) => m.enrollmentsConcept),
  aktivitaeten: () =>
    import("~/lib/concepts/activities").then((m) => m.activitiesConcept),
  allgemein: () =>
    import("~/lib/concepts/enrollments").then((m) => m.enrollmentsConcept),
  anmeldung: () =>
    import("~/lib/concepts/enrollments").then((m) => m.enrollmentsConcept),
  "anmeldung-essen": () =>
    import("~/lib/concepts/mealPlan").then((m) => m.mealPlanConcept),
  anwesenheit: () =>
    import("~/lib/concepts/activities").then((m) => m.activitiesConcept),
  auffaelligkeiten: () =>
    import("~/lib/concepts/reports").then((m) => m.reportsConcept),
  "anwesenheit-erfassen": () =>
    import("~/lib/concepts/present").then((m) => m.presentConcept),
  aufsicht: () =>
    import("~/lib/concepts/classDay").then((m) => m.classDayConcept),
  benachrichtigung: () =>
    import("~/lib/concepts/mails").then((m) => m.mailsConcept),
  benachrichtigungen: () =>
    import("~/lib/concepts/notifications").then((m) => m.notificationsConcept),
  betreuungsangebote: () =>
    import("~/lib/concepts/carePlan").then((m) => m.carePlanConcept),
  betreuungstage: () =>
    import("~/lib/concepts/calendar").then((m) => m.calendarConcept),
  betreuungszeiten: () =>
    import("~/lib/concepts/arrivalPickup").then((m) => m.arrivalPickupConcept),
  briefkopf: () =>
    import("~/lib/concepts/letterhead").then((m) => m.letterheadConcept),
  "qr-code": () =>
    import("~/lib/concepts/billing").then((m) => m.billingConcept),
  "bestellung-essen": () =>
    import("~/lib/concepts/mealPlan").then((m) => m.mealPlanConcept),
  bewegungsdaten: () =>
    import("~/lib/concepts/privacy").then((m) => m.privacyConcept),
  caterer: () =>
    import("~/lib/concepts/mealPlan").then((m) => m.mealPlanConcept),
  checkout: () =>
    import("~/lib/concepts/devices").then((m) => m.devicesConcept),
  dateien: () => import("~/lib/concepts/files").then((m) => m.filesConcept),
  datenbereinigung: () =>
    import("~/lib/concepts/privacy").then((m) => m.privacyConcept),
  datev_mandant: () =>
    import("~/lib/concepts/exports").then((m) => m.exportsConcept),
  "datev-lohn": () =>
    import("~/lib/concepts/payroll").then((m) => m.payrollConcept),
  "datev-buchungen": () =>
    import("~/lib/concepts/bookingAccounts").then(
      (m) => m.bookingAccountsConcept,
    ),
  "e-mail": () => import("~/lib/concepts/mails").then((m) => m.mailsConcept),
  einheiten: () =>
    import("~/lib/concepts/payroll").then((m) => m.payrollConcept),
  einladungen: () =>
    import("~/lib/concepts/accounts").then((m) => m.accountsConcept),
  elternmeldungen: () =>
    import("~/lib/concepts/requests").then((m) => m.requestsConcept),
  elternportal: () =>
    import("~/lib/concepts/parents").then((m) => m.parentsConcept),
  essensplan: () =>
    import("~/lib/concepts/mealPlan").then((m) => m.mealPlanConcept),
  feedback: () =>
    import("~/lib/concepts/feedback").then((m) => m.feedbackConcept),
  "ferien-anmeldung": () =>
    import("~/lib/concepts/enrollments").then((m) => m.enrollmentsConcept),
  "planung-in-moto": () =>
    import("~/lib/concepts/staffPlan").then((m) => m.staffPlanConcept),
  arbeitszeitregeln: () =>
    import("~/lib/concepts/timeTracking").then((m) => m.timeTrackingConcept),
  "ferien-beitrag": () =>
    import("~/lib/concepts/billing").then((m) => m.billingConcept),
  "ferien-bestaetigung": () =>
    import("~/lib/concepts/confirmations").then((m) => m.confirmationsConcept),
  "ferien-schreiben": () =>
    import("~/lib/concepts/documents").then((m) => m.documentsConcept),
  "monatsbeitrag-lauf": () =>
    import("~/lib/concepts/billing").then((m) => m.billingConcept),
  "monatsbeitrag-pruefung": () =>
    import("~/lib/concepts/changeHistory").then((m) => m.changeHistoryConcept),
  "monatsbeitrag-lastschrift": () =>
    import("~/lib/concepts/directDebit").then((m) => m.directDebitConcept),
  "vertraege-unterschrift": () =>
    import("~/lib/concepts/careContracts").then((m) => m.careContractsConcept),
  formular: () =>
    import("~/lib/concepts/enrollments").then((m) => m.enrollmentsConcept),
  "fristen-essen": () =>
    import("~/lib/concepts/mealPlan").then((m) => m.mealPlanConcept),
  "frueh-abgeholt": () =>
    import("~/lib/concepts/pickup").then((m) => m.pickupConcept),
  geburtstage: () =>
    import("~/lib/concepts/birthdays").then((m) => m.birthdaysConcept),
  "gebuchte-module": () =>
    import("~/lib/concepts/lists").then((m) => m.listsConcept),
  "info-displays": () =>
    import("~/lib/concepts/infoDisplays").then((m) => m.infoDisplaysConcept),
  kalender: () =>
    import("~/lib/concepts/calendar").then((m) => m.calendarConcept),
  kapazität: () =>
    import("~/lib/concepts/utilization").then((m) => m.utilizationConcept),
  kinder: () =>
    import("~/lib/concepts/children").then((m) => m.childrenConcept),
  "kinder-ohne-ogs-platz": () =>
    import("~/lib/concepts/children").then((m) => m.childrenConcept),
  lockout: () => import("~/lib/concepts/signIn").then((m) => m.signInConcept),
  lohnarten: () =>
    import("~/lib/concepts/payroll").then((m) => m.payrollConcept),
  lohndatei: () =>
    import("~/lib/concepts/payroll").then((m) => m.payrollConcept),
  mfa: () => import("~/lib/concepts/signIn").then((m) => m.signInConcept),
  monitoring: () =>
    import("~/lib/concepts/devices").then((m) => m.devicesConcept),
  "nach-hause": () => import("~/lib/concepts/home").then((m) => m.homeConcept),
  nutzungsanalyse: () =>
    import("~/lib/concepts/privacy").then((m) => m.privacyConcept),
  oeffnungszeiten: () =>
    import("~/lib/concepts/careTimes").then((m) => m.careTimesConcept),
  organisation: () =>
    import("~/lib/concepts/settings").then((m) => m.settingsConcept),
  personaldokumente: () =>
    import("~/lib/concepts/documents").then((m) => m.documentsConcept),
  pin: () => import("~/lib/concepts/signIn").then((m) => m.signInConcept),
  rechtstexte: () =>
    import("~/lib/concepts/legalNotice").then((m) => m.legalNoticeConcept),
  "vertrag-bestaetigungen": () =>
    import("~/lib/concepts/confirmations").then((m) => m.confirmationsConcept),
  vertragsabschluss: () =>
    import("~/lib/concepts/careContracts").then((m) => m.careContractsConcept),
  "zustaendige-stellen": () =>
    import("~/lib/concepts/responsibility").then(
      (m) => m.responsibilityConcept,
    ),
  schulstunden: () =>
    import("~/lib/concepts/inClass").then((m) => m.inClassConcept),
  schülerdaten: () =>
    import("~/lib/concepts/children").then((m) => m.childrenConcept),
  "sehen-und-bearbeiten": () =>
    import("~/lib/concepts/permissions").then((m) => m.permissionsConcept),
  sicherheit: () =>
    import("~/lib/concepts/enrollments").then((m) => m.enrollmentsConcept),
  sitzungsbereinigung: () =>
    import("~/lib/concepts/supervision").then((m) => m.supervisionConcept),
  sitzungsende: () =>
    import("~/lib/concepts/supervision").then((m) => m.supervisionConcept),
  standort: () =>
    import("~/lib/concepts/publicHolidays").then(
      (m) => m.publicHolidaysConcept,
    ),
  stundenplan: () =>
    import("~/lib/concepts/carePlan").then((m) => m.carePlanConcept),
  team: () => import("~/lib/concepts/messages").then((m) => m.messagesConcept),
  termine: () =>
    import("~/lib/concepts/calendar").then((m) => m.calendarConcept),
  zeiterfassung: () =>
    import("~/lib/concepts/timeTracking").then((m) => m.timeTrackingConcept),
  "zeitkonten-export": () =>
    import("~/lib/concepts/exportRecipients").then(
      (m) => m.exportRecipientsConcept,
    ),
};

/**
 * Das Konzept einer Kategorie. Eine Kategorie ohne Eintrag (neu im Backend,
 * noch ohne Bezeichnung) trägt das Konzept ihres Reiters.
 */
export async function settingsCategoryConcept(
  categoryKey: string,
  tabKey: string,
): Promise<MotoConcept> {
  const loader = CATEGORY_CONCEPTS[categoryKey];
  if (loader) return loader();
  const { settingsTabConcept } = await import("./settings-sections");
  return settingsTabConcept(tabKey);
}
