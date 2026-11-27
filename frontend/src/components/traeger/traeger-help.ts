/**
 * The help entry of the Träger portal (#4649): the article for the page the
 * Träger-Büro is on. The shared header's `?` (#5145, `ContextHelpLink`)
 * builds the link with the Träger role, so the help opens the right sidebar,
 * and with the page as `return_to`.
 */
import { HELP_TOPICS, type HelpTopicId } from "~/lib/help-topics";

/** `/ferien/{id}/anmeldungen` and its registrations (#4663). */
const HOLIDAY_REGISTRATIONS_PAGE = /^\/ferien\/[^/]+\/anmeldungen(?:\/|$)/;

/** `/ferien/{id}/formular`, the form of a holiday period (#5198). */
const HOLIDAY_FORM_PAGE = /^\/ferien\/[^/]+\/formular$/;

/** `/ferien/{id}/plaetze`, the places and waitlist of a holiday period. */
const HOLIDAY_PLACES_PAGE = /^\/ferien\/[^/]+\/plaetze$/;

function onPage(page: string, path: string): boolean {
  return page === path || page.startsWith(`${path}/`);
}

/**
 * The help article for a Träger page (pathname with or without /traeger).
 * Pages without an article of their own lead to the sign-in article, which
 * explains the portal.
 */
export function getTraegerHelpTopicForPath(pathname: string): HelpTopicId {
  const page = pathname.replace(/^\/traeger(?=\/|$)/, "") || "/";
  if (onPage(page, "/uebersicht")) return HELP_TOPICS.traegerDashboard;
  if (onPage(page, "/belegung")) return HELP_TOPICS.traegerOccupancy;
  if (onPage(page, "/auslastung")) return HELP_TOPICS.traegerUtilization;
  if (onPage(page, "/ankunft-abholung")) {
    return HELP_TOPICS.traegerArrivalPickupTimes;
  }
  if (onPage(page, "/standortvergleich")) {
    return HELP_TOPICS.traegerSchoolComparison;
  }
  if (onPage(page, "/berichte")) return HELP_TOPICS.traegerReports;
  if (onPage(page, "/tagesmeldung")) return HELP_TOPICS.traegerDailyAttendance;
  if (onPage(page, "/schulen")) return HELP_TOPICS.traegerSchoolView;
  if (onPage(page, "/kinder")) return HELP_TOPICS.traegerChildren;
  if (onPage(page, "/dokumente")) return HELP_TOPICS.traegerSharedDocuments;
  if (onPage(page, "/personal/abwesenheitsarten")) {
    return HELP_TOPICS.traegerAbsenceTypes;
  }
  if (onPage(page, "/personal/einsatzplanung")) {
    return HELP_TOPICS.traegerStaffPlanning;
  }
  if (onPage(page, "/personal/vertretungspool")) {
    return HELP_TOPICS.traegerStaffPool;
  }
  if (onPage(page, "/personal/lohnexport")) {
    return HELP_TOPICS.traegerPayrollExport;
  }
  if (onPage(page, "/personal")) return HELP_TOPICS.traegerStaffRecords;
  if (onPage(page, "/nachweise")) return HELP_TOPICS.traegerStaffProofs;
  if (onPage(page, "/konto")) return HELP_TOPICS.traegerProfile;
  if (onPage(page, "/einstellungen/mitglieder")) {
    return HELP_TOPICS.traegerAccounts;
  }
  if (onPage(page, "/einstellungen/schulrollen")) {
    return HELP_TOPICS.traegerSchoolRoles;
  }
  if (onPage(page, "/einstellungen/zugriffsprotokoll")) {
    return HELP_TOPICS.traegerAccessLog;
  }
  if (onPage(page, "/einstellungen/briefkopf/vorlagen")) {
    return HELP_TOPICS.traegerDocumentTemplates;
  }
  if (onPage(page, "/einstellungen/briefkopf")) {
    return HELP_TOPICS.traegerBriefkopf;
  }
  if (onPage(page, "/einstellungen/module")) {
    return HELP_TOPICS.traegerModules;
  }
  if (onPage(page, "/einstellungen/dokumentarten")) {
    return HELP_TOPICS.traegerDocumentKinds;
  }
  if (onPage(page, "/einstellungen/zustaendigkeiten")) {
    return HELP_TOPICS.traegerResponsibilities;
  }
  if (onPage(page, "/einstellungen/abrechnung")) {
    return HELP_TOPICS.traegerHolidayContribution;
  }
  if (onPage(page, "/einstellungen")) return HELP_TOPICS.traegerSettings;
  if (onPage(page, "/abrechnung/rechnungsausgangsbuch")) {
    return HELP_TOPICS.traegerInvoiceJournal;
  }
  if (onPage(page, "/abrechnung/jahresbescheide")) {
    return HELP_TOPICS.traegerCareNotices;
  }
  if (
    onPage(page, "/abrechnung/monatsbeitraege") ||
    onPage(page, "/abrechnung/preise")
  ) {
    return HELP_TOPICS.traegerCareMonths;
  }
  if (onPage(page, "/abrechnung/mensa")) return HELP_TOPICS.traegerCareMeals;
  if (
    onPage(page, "/abrechnung/ermaessigungen") ||
    onPage(page, "/abrechnung/nachweise") ||
    onPage(page, "/abrechnung/kinderzahl")
  ) {
    return HELP_TOPICS.traegerCareReductions;
  }
  if (onPage(page, "/abrechnung/exporte")) {
    return HELP_TOPICS.traegerFinanceExports;
  }
  if (onPage(page, "/abrechnung/lastschrift")) {
    return HELP_TOPICS.traegerSepaMandates;
  }
  if (onPage(page, "/abrechnung/kostentraeger")) {
    return HELP_TOPICS.traegerCareCostShares;
  }
  if (onPage(page, "/abrechnung")) return HELP_TOPICS.traegerBillingRun;
  if (onPage(page, "/vertraege")) return HELP_TOPICS.traegerCareContracts;
  if (onPage(page, "/zeitvergleich"))
    return HELP_TOPICS.traegerCareTimeOverruns;
  if (onPage(page, "/ferien/zusatztage")) {
    return HELP_TOPICS.traegerExtraCareDay;
  }
  if (HOLIDAY_FORM_PAGE.test(page)) return HELP_TOPICS.traegerHolidayForm;
  if (HOLIDAY_PLACES_PAGE.test(page)) return HELP_TOPICS.traegerHolidayPlaces;
  if (HOLIDAY_REGISTRATIONS_PAGE.test(page)) {
    return HELP_TOPICS.traegerHolidayRegistrationReview;
  }
  return HELP_TOPICS.traegerLogin;
}
