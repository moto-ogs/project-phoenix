import type { MotoConcept } from "~/lib/moto-concepts";
import { absencesConcept } from "~/lib/concepts/absences";
import { accountsConcept } from "~/lib/concepts/accounts";
import { activitiesConcept } from "~/lib/concepts/activities";
import { arrivalPickupConcept } from "~/lib/concepts/arrivalPickup";
import { billingConcept } from "~/lib/concepts/billing";
import { birthdaysConcept } from "~/lib/concepts/birthdays";
import { bookingAccountsConcept } from "~/lib/concepts/bookingAccounts";
import { calendarConcept } from "~/lib/concepts/calendar";
import { careContractsConcept } from "~/lib/concepts/careContracts";
import { carePlanConcept } from "~/lib/concepts/carePlan";
import { careTimesConcept } from "~/lib/concepts/careTimes";
import { changeHistoryConcept } from "~/lib/concepts/changeHistory";
import { childrenConcept } from "~/lib/concepts/children";
import { classDayConcept } from "~/lib/concepts/classDay";
import { confirmationsConcept } from "~/lib/concepts/confirmations";
import { devicesConcept } from "~/lib/concepts/devices";
import { directDebitConcept } from "~/lib/concepts/directDebit";
import { documentsConcept } from "~/lib/concepts/documents";
import { enrollmentsConcept } from "~/lib/concepts/enrollments";
import { exportRecipientsConcept } from "~/lib/concepts/exportRecipients";
import { exportsConcept } from "~/lib/concepts/exports";
import { feedbackConcept } from "~/lib/concepts/feedback";
import { filesConcept } from "~/lib/concepts/files";
import { homeConcept } from "~/lib/concepts/home";
import { inClassConcept } from "~/lib/concepts/inClass";
import { infoDisplaysConcept } from "~/lib/concepts/infoDisplays";
import { legalNoticeConcept } from "~/lib/concepts/legalNotice";
import { letterheadConcept } from "~/lib/concepts/letterhead";
import { listsConcept } from "~/lib/concepts/lists";
import { mailsConcept } from "~/lib/concepts/mails";
import { mealPlanConcept } from "~/lib/concepts/mealPlan";
import { messagesConcept } from "~/lib/concepts/messages";
import { notificationsConcept } from "~/lib/concepts/notifications";
import { parentsConcept } from "~/lib/concepts/parents";
import { payrollConcept } from "~/lib/concepts/payroll";
import { permissionsConcept } from "~/lib/concepts/permissions";
import { pickupConcept } from "~/lib/concepts/pickup";
import { presentConcept } from "~/lib/concepts/present";
import { privacyConcept } from "~/lib/concepts/privacy";
import { publicHolidaysConcept } from "~/lib/concepts/publicHolidays";
import { reportsConcept } from "~/lib/concepts/reports";
import { requestsConcept } from "~/lib/concepts/requests";
import { responsibilityConcept } from "~/lib/concepts/responsibility";
import { settingsConcept } from "~/lib/concepts/settings";
import { signInConcept } from "~/lib/concepts/signIn";
import { staffPlanConcept } from "~/lib/concepts/staffPlan";
import { supervisionConcept } from "~/lib/concepts/supervision";
import { timeTrackingConcept } from "~/lib/concepts/timeTracking";
import { utilizationConcept } from "~/lib/concepts/utilization";
import { settingsTabConcept } from "./settings-sections";

/**
 * Das Konzept-Symbol jeder Einstellungs-Kategorie (#8221, Spec #8220), Schlüssel
 * für Schlüssel neben `categoryLabels` in `settings-filter.ts`. Die Karte
 * einer Kategorie zeigt es nur, wenn ihre Ansicht nach der Themenkarten-Regel
 * (`.claude/rules/frontend-ui-kit.md`, Kartenkopf) mehrere Themenkarten hat;
 * das entscheidet der Aufrufer über `withIcon` an `SettingsCategory`.
 * Wer eine Kategorie-Bezeichnung anlegt, trägt hier ihr Konzept ein, sonst
 * schlägt `settings-category-concepts.test.ts` fehl. Eigene Datei, damit die
 * immer geladene Navigation (`settings-sections.ts`) diese Glyphen nicht
 * mitzieht.
 */
export const CATEGORY_CONCEPTS: Readonly<Record<string, MotoConcept>> = {
  abholung: pickupConcept,
  abwesenheit: absencesConcept,
  aktivierung: enrollmentsConcept,
  aktivitaeten: activitiesConcept,
  allgemein: enrollmentsConcept,
  anmeldung: enrollmentsConcept,
  "anmeldung-essen": mealPlanConcept,
  anwesenheit: activitiesConcept,
  auffaelligkeiten: reportsConcept,
  "anwesenheit-erfassen": presentConcept,
  aufsicht: classDayConcept,
  benachrichtigung: mailsConcept,
  benachrichtigungen: notificationsConcept,
  betreuungsangebote: carePlanConcept,
  betreuungstage: calendarConcept,
  betreuungszeiten: arrivalPickupConcept,
  briefkopf: letterheadConcept,
  "qr-code": billingConcept,
  "bestellung-essen": mealPlanConcept,
  bewegungsdaten: privacyConcept,
  caterer: mealPlanConcept,
  checkout: devicesConcept,
  dateien: filesConcept,
  datenbereinigung: privacyConcept,
  datev_mandant: exportsConcept,
  "datev-lohn": payrollConcept,
  "datev-buchungen": bookingAccountsConcept,
  "e-mail": mailsConcept,
  einheiten: payrollConcept,
  einladungen: accountsConcept,
  elternmeldungen: requestsConcept,
  elternportal: parentsConcept,
  essensplan: mealPlanConcept,
  feedback: feedbackConcept,
  "ferien-anmeldung": enrollmentsConcept,
  "planung-in-moto": staffPlanConcept,
  arbeitszeitregeln: timeTrackingConcept,
  "ferien-beitrag": billingConcept,
  "ferien-bestaetigung": confirmationsConcept,
  "ferien-schreiben": documentsConcept,
  "monatsbeitrag-lauf": billingConcept,
  "monatsbeitrag-pruefung": changeHistoryConcept,
  "monatsbeitrag-lastschrift": directDebitConcept,
  "vertraege-unterschrift": careContractsConcept,
  formular: enrollmentsConcept,
  "fristen-essen": mealPlanConcept,
  "frueh-abgeholt": pickupConcept,
  geburtstage: birthdaysConcept,
  "gebuchte-module": listsConcept,
  "info-displays": infoDisplaysConcept,
  kalender: calendarConcept,
  kapazität: utilizationConcept,
  kinder: childrenConcept,
  "kinder-ohne-ogs-platz": childrenConcept,
  lockout: signInConcept,
  lohnarten: payrollConcept,
  lohndatei: payrollConcept,
  mfa: signInConcept,
  monitoring: devicesConcept,
  "nach-hause": homeConcept,
  nutzungsanalyse: privacyConcept,
  oeffnungszeiten: careTimesConcept,
  organisation: settingsConcept,
  personaldokumente: documentsConcept,
  pin: signInConcept,
  rechtstexte: legalNoticeConcept,
  "vertrag-bestaetigungen": confirmationsConcept,
  vertragsabschluss: careContractsConcept,
  "zustaendige-stellen": responsibilityConcept,
  schulstunden: inClassConcept,
  schülerdaten: childrenConcept,
  "sehen-und-bearbeiten": permissionsConcept,
  sicherheit: enrollmentsConcept,
  sitzungsbereinigung: supervisionConcept,
  sitzungsende: supervisionConcept,
  standort: publicHolidaysConcept,
  stundenplan: carePlanConcept,
  team: messagesConcept,
  termine: calendarConcept,
  zeiterfassung: timeTrackingConcept,
  "zeitkonten-export": exportRecipientsConcept,
};

/**
 * Das Konzept einer Kategorie. Eine Kategorie ohne Eintrag (neu im Backend,
 * noch ohne Bezeichnung) trägt das Konzept ihres Reiters.
 */
export function settingsCategoryConcept(
  categoryKey: string,
  tabKey: string,
): MotoConcept {
  return CATEGORY_CONCEPTS[categoryKey] ?? settingsTabConcept(tabKey);
}
