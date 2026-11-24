/**
 * Page titles (WCAG 2.4.2, #7109): every page names itself in the browser tab
 * and to screen readers as `<Seite> – moto`.
 *
 * The title belongs to the route template, not to the loaded record: a tab
 * shows „Kindakte – moto“, never a child's name. Tab titles end up in
 * the browser history, bookmarks and shared screens, so they carry no
 * personal data (data minimisation), and they are there before any data has
 * loaded.
 *
 * `page-titles.test.ts` fails when a `page.tsx` has no title here, and when
 * two pages of one portal share a title.
 */

import { PORTAL_ROUTES, type PortalKey } from "./portal-paths";
import { createRouteTemplateMatcher, pathBelow } from "./route-templates";

export type PageTitleSurface =
  "ogs" | "parents" | "school" | "caterer" | "traeger" | "operator" | "public";

/** Suffix of every title. */
const PAGE_TITLE_BRAND = "moto";

/** The tenant's catch-all 404 page (`[tenant]/[...not-found]`). */
export const OGS_NOT_FOUND_TEMPLATE = "/:not-found*";

/** Pages of the German-only portals, by route template. */
export const GERMAN_PAGE_TITLES: Readonly<
  Record<PageTitleSurface, Readonly<Record<string, string>>>
> = {
  // The parents portal is translated: LOCALIZED_PAGE_TITLES.
  parents: {},
  ogs: {
    // Tenant host outside (protected): login, display, invitation.
    "/": "Anmelden",
    "/demo": "Demo",
    "/display": "Info-Display",
    "/invite": "Einladung annehmen",
    "/reset-password": "Passwort zurücksetzen",
    "/traeger-uebergabe": "Wechsel aus dem Träger-Portal",
    [OGS_NOT_FOUND_TEMPLATE]: "Seite nicht gefunden",

    "/absences": "Abwesenheiten",
    "/active-supervisions": "Aktuelle Aufsicht",
    "/activities": "Aktivitäten",
    "/admin/change-requests": "Anfragen",
    "/admin/enrollments": "Anmeldungen",
    "/admin/enrollments/:id": "Anmeldung",
    "/admin/enrollments/change-requests": "Anfragen",
    "/admin/enrollments/change-requests/:id": "Änderungsanfrage",
    "/admin/enrollments/phases/:phaseId": "Anmeldephase",
    "/admin/guardian-approvals": "Elternzugänge",
    "/anfragen": "Anfragen",
    "/betreuungsplan": "Betreuungsplan",
    "/calendar": "Mein Kalender",
    "/calendar-periods": "Schuljahr und Kalender",
    "/care-offerings": "Betreuungsangebote",
    "/dashboard": "Startseite",
    "/database": "Datenverwaltung",
    "/database/absence-types": "Abwesenheitsarten",
    "/database/activities": "Aktivitätsdaten",
    "/database/categories": "Terminkategorien",
    "/database/devices": "Geräte",
    "/database/exports": "Exporte",
    "/database/grade-transitions": "Schuljahreswechsel",
    "/database/groups": "Gruppendaten",
    "/database/permissions": "Berechtigungen",
    "/database/personal": "Personal",
    "/database/personal/import": "Personal importieren",
    "/database/personal/opening-balances": "Eröffnungssalden",
    "/database/planning-tracks": "Planungsspuren",
    "/database/qualification-types": "Nachweisarten",
    "/database/qualifications": "Nachweise",
    "/database/roles": "Rollen",
    "/database/rooms": "Raumdaten",
    "/database/shift-types": "Dienstarten",
    "/database/students": "Kinderdaten",
    "/database/students/class-list": "Klassenliste",
    "/database/students/class-list/import": "Klassenliste importieren",
    "/database/students/ended-care": "Beendete Betreuungen",
    "/database/students/import": "Kinder importieren",
    "/database/work-time-models": "Arbeitszeitmodelle",
    "/dateien": "Dateien",
    "/day-log": "Tagesauswertung",
    "/dienstplan": "Dienstplan",
    "/dienstplan/springer": "Springer",
    "/eltern/bankverbindungen": "Bankverbindungen",
    "/emergency": "Notfallliste",
    "/enrollment-form": "Anmeldeformulare",
    "/enrollment-phases": "Anmeldephasen",
    "/enrollment-phases/:id/review": "Prüfliste der Anmeldephase",
    "/enrollment-phases/:id/rollover": "Anschlussphase erstellen",
    "/ferienwochen": "Ferienwochen",
    "/home": "Startseite",
    "/info-displays": "Info-Displays",
    "/lists": "Tageslisten",
    "/meal-plan": "Speiseplan",
    "/meal-plan/freigabe": "Mensa-Freigabe",
    "/mein-dienstplan": "Mein Dienstplan",
    "/messages": "Nachrichten",
    "/messages/:threadId": "Unterhaltung",
    "/messages/groups": "Gruppennachrichten",
    "/messages/groups/:groupThreadId": "Gruppennachricht",
    "/ogs-groups": "Gruppen",
    "/ogs-groups/overview": "Gruppenübersicht",
    "/parent-announcements": "Mitteilungen",
    "/parent-announcements/:id": "Mitteilung",
    "/parent-attention/:studentId": "Kindakte",
    "/payroll": "Abrechnung",
    "/profile": "Profil",
    "/reminders": "Erinnerungen",
    "/rooms": "Räume",
    "/rooms/:id": "Raum",
    "/rooms/unterwegs": "Unterwegs",
    "/settings": "Einstellungen",
    "/staff": "Mitarbeitende",
    "/staff/:id": "Person",
    "/statistics": "Statistik",
    "/students/:id": "Kindakte",
    "/students/:id/change-history": "Änderungsverlauf",
    "/students/:id/feedback-history": "Feedbackhistorie",
    "/students/:id/room-history": "Anwesenheitsprotokoll",
    "/students/:id/unfallanzeigen/:reportId": "Unfallanzeige",
    "/students/search": "Alle Kinder",
    "/substitutions": "Übergaben",
    "/tagesinformationen": "Hinweise der Leitung",
    "/tagesplan": "Heute",
    "/team-chat": "Team-Chat",
    "/team-chat/:threadID": "Unterhaltung im Team-Chat",
    "/time-tracking": "Zeiterfassung",
    "/umfragen": "Umfragen",
    "/umfragen/:id": "Umfrage",
    "/vertretung": "Vertretung",
    "/wochenprotokolle": "Wochenprotokolle",
    "/wochenprotokolle/:protocolId": "Wochenprotokoll",
  },
  school: {
    "/": "Tagesübersicht",
    "/aufsichten": "Aufsichten",
    "/einstellungen": "Einstellungen",
    "/elternbriefe": "Elternbriefe",
    "/elternbriefe/:id": "Elternbrief",
    "/elternsprechtag": "Elternsprechtag",
    "/fehlzeiten": "Fehlzeiten",
    "/invite": "Einladung annehmen",
    "/kalender": "Kalender",
    "/klasse": "Klasse",
    "/klasse/kind": "Beobachtungen der OGS",
    "/login": "Anmelden",
    "/nachrichten": "Nachrichten",
    "/nachrichten/:threadID": "Unterhaltung",
    "/reset-password": "Passwort zurücksetzen",
    "/tagesinformationen": "Hinweise der Leitung",
  },
  caterer: {
    "/": "Übersicht",
    "/einladung/:schoolId/:token": "Einladung annehmen",
    "/konto": "Konto",
    "/login": "Anmelden",
    "/reset-password": "Passwort zurücksetzen",
  },
  traeger: {
    "/": "Schulen",
    "/abrechnung": "Abrechnungsläufe",
    "/abrechnung/:id": "Abrechnungslauf",
    "/abrechnung/:id/faelligkeiten": "Fälligkeiten des Abrechnungslaufs",
    "/abrechnung/ermaessigungen": "Ermäßigungen",
    "/abrechnung/exporte": "Exporte",
    "/abrechnung/exporte/empfaenger": "Empfänger der Exporte",
    "/abrechnung/exporte/empfaenger/:id": "Empfänger",
    "/abrechnung/exporte/empfaenger/neu": "Neuer Empfänger",
    "/abrechnung/exporte/feldzuordnung": "Feldzuordnung",
    "/abrechnung/exporte/konten": "Konten und Kostenstellen",
    "/abrechnung/familien": "Familien",
    "/abrechnung/familien/:id": "Familie",
    "/abrechnung/familien/zahlung/:contractId":
      "Empfänger und Zahlung der Familie",
    "/abrechnung/jahresbescheide": "Jahresbescheide",
    "/abrechnung/jahresbescheide/:id": "Jahreslauf",
    "/abrechnung/jahresbescheide/:id/bescheid/:contractId": "Jahresbescheid",
    "/abrechnung/jahresbescheide/:id/lastschrift":
      "Lastschrift des Jahreslaufs",
    "/abrechnung/jahresbescheide/:id/versand": "Versand der Jahresbescheide",
    "/abrechnung/kinderzahl": "Kinderzahl",
    "/abrechnung/kinderzahl/import": "Kinderzahl nachtragen",
    "/abrechnung/kostentraeger": "Kostenübernahmen",
    "/abrechnung/lastschrift": "Lastschrift",
    "/abrechnung/lastschrift/:contractId": "Lastschriftmandat",
    "/abrechnung/lastschrift/import": "Mandate importieren",
    "/abrechnung/mensa": "Mensa",
    "/abrechnung/monatsbeitraege": "Monatsbeiträge",
    "/abrechnung/monatsbeitraege/:id": "Monatslauf",
    "/abrechnung/monatsbeitraege/:id/empfaenger/:contractId":
      "Empfänger und Zahlung",
    "/abrechnung/monatsbeitraege/:id/faelligkeiten":
      "Fälligkeiten des Monatslaufs",
    "/abrechnung/monatsbeitraege/:id/rechnung/:contractId": "Rechnung ändern",
    "/abrechnung/monatsbeitraege/:id/schreiben": "Schreiben und Versand",
    "/abrechnung/nachweise": "Nachweise",
    "/abrechnung/preise": "Preisliste",
    "/ankunft-abholung": "Ankunft und Abholung",
    "/anmeldephasen": "Anmeldephasen",
    "/anmeldephasen/:id": "Anmeldephase",
    "/anmeldephasen/:id/angebote/:offeringId": "Betreuungsangebot",
    "/anmeldephasen/:id/angebote/neu": "Neues Betreuungsangebot",
    "/anmeldephasen/:id/vorschau": "Vorschau der Anmeldephase",
    "/anmeldephasen/neu": "Neue Anmeldephase",
    "/auslastung": "Auslastung",
    "/belegung": "Belegung",
    "/berichte": "Berichte",
    "/berichte/vorlagen/:id": "Berichtsvorlage",
    "/berichte/vorlagen/neu": "Neue Berichtsvorlage",
    "/demo": "Demo",
    "/dokumente": "Dokumente",
    "/dokumente/:id": "Dokument",
    "/einstellungen": "Allgemeine Einstellungen",
    "/einstellungen/abrechnung": "Abrechnungsvorgaben",
    "/einstellungen/briefkopf": "Briefkopf und Vorlagen",
    "/einstellungen/briefkopf/vorlagen": "Vorlagen",
    "/einstellungen/briefkopf/vorlagen/:kind": "Vorlage",
    "/einstellungen/dokumentarten": "Dokumentarten",
    "/einstellungen/mitglieder": "Mitglieder und Rollen",
    "/einstellungen/module": "moto-Module",
    "/einstellungen/schulrollen": "Rollen für Schulen",
    "/einstellungen/zugriffsprotokoll": "Zugriffsprotokoll",
    "/einstellungen/zustaendigkeiten": "Zuständigkeiten",
    "/ferien": "Ferienbetreuung",
    "/ferien/:id": "Ferienzeitraum",
    "/ferien/:id/anmeldungen": "Ferienanmeldungen",
    "/ferien/:id/anmeldungen/:registrationId": "Ferienanmeldung",
    "/ferien/:id/formular": "Formular der Ferienanmeldung",
    "/ferien/:id/plaetze": "Plätze im Ferienzeitraum",
    "/ferien/:id/vergabe": "Platzvergabe",
    "/ferien/kriterien": "Kriterien der Platzvergabe",
    "/ferien/neu": "Neuer Ferienzeitraum",
    "/invite": "Einladung annehmen",
    "/konto": "Konto",
    "/login": "Anmelden",
    "/nachweise": "Personalnachweise",
    "/personal": "Personalakten",
    "/personal/:id": "Personalakte",
    "/personal/abwesenheitsarten": "Abwesenheitsarten",
    "/personal/einsatzplanung": "Einsatzplanung",
    "/personal/einstellen": "Person einstellen",
    "/personal/vertretungspool": "Vertretungspool",
    "/personal/import": "Personal importieren",
    "/personal/lohnexport": "Lohnexport",
    "/reset-password": "Passwort zurücksetzen",
    "/schliesstage": "Schließtage und Feiertage",
    "/schulen/:id": "Schule",
    "/standortvergleich": "Standortvergleich",
    "/tagesmeldung": "Tagesmeldung",
    "/uebersicht": "Dashboard",
    "/vertraege": "Verträge",
    "/vertraege/:id": "Vertrag",
    "/vertraege/bedingungen": "Vertragsbedingungen",
    "/vertraege/import": "Verträge importieren",
    "/vertraege/nachpflege": "Vertragsangaben nachpflegen",
    "/vertraege/module-zuordnen": "Module neu zuordnen",
    "/vertraege/verknuepfen": "Verträge mit Kinderakten verknüpfen",
    "/vertraege/anmeldungen": "Anmeldungen nachtragen",
    "/zeitvergleich": "Länger als gebucht",
  },
  operator: {
    "/": "Träger",
    "/accounts": "Konten",
    "/announcements": "Ankündigungen",
    "/billing": "Stichtagszahlen",
    "/caterers": "Caterer",
    "/devices": "Geräte",
    "/email-confirm": "E-Mail-Adresse bestätigen",
    "/invite": "Einladung annehmen",
    "/login": "Anmelden",
    "/operators": "Operatoren",
    "/organizations": "Träger",
    "/organizations/:slug": "Träger-Details",
    "/organizations/:slug/schools/:schoolSlug": "Schul-Details",
    "/persons": "Personen",
    "/provisioning": "Träger",
    "/schools": "Schulen",
    "/schools/:id/settings": "Einstellungen der Schule",
    "/settings": "Profil",
    "/unregistered-tags": "Unbekannte RFID",
  },
  public: {
    "/": "Digitale Ganztagsbetreuung",
    "/demo": "Demo",
    "/invite": "Einladung annehmen",
    "/onboarding": "Erstgespräch",
    "/reset-password": "Passwort zurücksetzen",
    "/start": "Erstgespräch",
  },
};

/**
 * Pages of the localized surfaces: the message key below `pageTitles.pages`
 * (`src/i18n/messages/<locale>/pageTitles.json`).
 */
export const LOCALIZED_PAGE_TITLES: Readonly<
  Partial<Record<PageTitleSurface, Readonly<Record<string, string>>>>
> = {
  parents: {
    "/": "start",
    "/accept-guardian-invite/:token": "guardianInvite",
    "/anmeldung": "enrollmentStart",
    "/anmeldung/:tenantSlug/:phaseId": "enrollmentForm",
    "/anmeldung/status/:token": "enrollmentStatus",
    "/anmeldung/status/:token/adjust": "enrollmentAdjust",
    "/anmeldung/status/:token/edit": "enrollmentEdit",
    "/calendar": "calendar",
    "/children": "children",
    "/children/:id": "childProfile",
    "/children/:id/elternsprechtag": "conference",
    "/demo": "demo",
    "/documents": "documents",
    "/documents/vertraege/:organizationId/:contractId": "contractEnd",
    "/documents/vertrag/:organizationId/:contractId": "contract",
    "/ferienanmeldung/:token": "holidayRegistration",
    "/ferienanmeldung/status/:token": "holidayRegistrationStatus",
    "/ferienanmeldungen": "holidayRegistrations",
    "/ferienkonto/:token": "holidayAccount",
    "/invite": "invite",
    "/login": "login",
    "/meal-plan": "mealPlan",
    "/messages": "messages",
    "/messages/:studentId": "conversation",
    "/messages/group/:groupThreadId": "groupMessage",
    "/news": "news",
    "/news/:id/nachweis": "declarationProof",
    "/reset-password": "resetPassword",
    "/settings": "settings",
    "/vertrag-unterschreiben/:link": "contractSign",
  },
  // Public enrollment on the tenant host renders in the parent's language.
  ogs: {
    "/anmeldung": "enrollmentStart",
    "/anmeldung/:phaseId": "enrollmentForm",
    "/anmeldung/preview": "enrollmentPreview",
    "/anmeldung/status/:token": "enrollmentStatus",
    "/anmeldung/status/:token/adjust": "enrollmentAdjust",
    "/anmeldung/status/:token/edit": "enrollmentEdit",
    "/anmeldung/submitted": "enrollmentSubmitted",
  },
};

/**
 * Public pages that set their title through the Metadata API (server
 * components): the help and the payroll office download. They render on the
 * portal hosts too (`/help`), so they are checked on every surface.
 */
export const METADATA_TITLE_TEMPLATES = [
  "/help",
  "/help/:topic*",
  "/help/nfc/erste-schritte",
  "/lohnbuero/:link",
] as const;

/** The messages below `pageTitles` a localized surface hands to the title. */
export interface LocalizedPageTitleMessages {
  readonly pages: Readonly<Record<string, string>>;
}

export type ResolvedPageTitle =
  | {
      readonly kind: "route";
      readonly surface: PageTitleSurface;
      readonly template: string;
    }
  | { readonly kind: "metadata" };

const SURFACES: readonly PageTitleSurface[] = [
  "ogs",
  "parents",
  "school",
  "caterer",
  "traeger",
  "operator",
  "public",
];

function templatesOf(surface: PageTitleSurface): string[] {
  return [
    ...Object.keys(GERMAN_PAGE_TITLES[surface]),
    ...Object.keys(LOCALIZED_PAGE_TITLES[surface] ?? {}),
  ].filter((template) => template !== OGS_NOT_FOUND_TEMPLATE);
}

const matchers = Object.fromEntries(
  SURFACES.map((surface) => [
    surface,
    createRouteTemplateMatcher(templatesOf(surface)),
  ]),
) as Record<PageTitleSurface, (pathname: string) => string | null>;

const metadataMatcher = createRouteTemplateMatcher(METADATA_TITLE_TEMPLATES);

/** Portal hosts serve their pages without the `/<portal>` namespace. */
const PORTAL_PREFIXES: ReadonlyArray<readonly [PageTitleSurface, string]> = [
  ["parents", PORTAL_ROUTES.parent.appPrefix],
  ["school", PORTAL_ROUTES.school.appPrefix],
  ["caterer", PORTAL_ROUTES.caterer.appPrefix],
  ["traeger", PORTAL_ROUTES.traeger.appPrefix],
  ["operator", PORTAL_ROUTES.operator.appPrefix],
];

function route(
  surface: PageTitleSurface,
  template: string | null,
): ResolvedPageTitle | null {
  return template ? { kind: "route", surface, template } : null;
}

/**
 * A school's page. On its own host the path is the page (`/home`); with path
 * routing on the bare domain the slug comes first (`/<slug>/home`) and the
 * slug alone is the school's login.
 */
function resolveOgs(pathname: string, pathRouting: boolean): ResolvedPageTitle {
  const direct = matchers.ogs(pathname);
  if (direct) return { kind: "route", surface: "ogs", template: direct };
  const segments = pathname.split("/").filter(Boolean);
  const slugless = `/${segments.slice(1).join("/")}`;
  const template = !pathRouting
    ? null
    : segments.length === 1
      ? "/"
      : matchers.ogs(slugless);
  return {
    kind: "route",
    surface: "ogs",
    template: template ?? OGS_NOT_FOUND_TEMPLATE,
  };
}

function resolveOnPortal(
  surface: PageTitleSurface,
  pathname: string,
): ResolvedPageTitle | null {
  const prefix = PORTAL_PREFIXES.find(([key]) => key === surface)?.[1];
  const below = prefix ? pathBelow(pathname, prefix) : null;
  return route(surface, matchers[surface](below ?? pathname));
}

/**
 * The page a browser path shows on the host's surface. `public` is the bare
 * domain and local path routing: there the portal namespace is part of the
 * path (`/parents/children`). Returns null for a path no page serves.
 * On an OGS host, only that host's tenant prefix is an alias of the page.
 */
export function resolvePageTitle(
  hostSurface: PageTitleSurface,
  rawPathname: string,
  tenantSlug: string | null = null,
): ResolvedPageTitle | null {
  const pathname =
    rawPathname.length > 1
      ? rawPathname.replace(/\/+$/, "") || "/"
      : rawPathname;
  if (metadataMatcher(pathname)) return { kind: "metadata" };

  if (hostSurface === "ogs") {
    // The proxy accepts /login and already-prefixed paths on a tenant host.
    // A foreign slug must not turn an unknown path into a known page.
    const appPath =
      pathname === "/login"
        ? "/"
        : tenantSlug
          ? (pathBelow(pathname, `/${tenantSlug}`) ?? pathname)
          : pathname;
    return resolveOgs(appPath, false);
  }
  if (hostSurface !== "public") return resolveOnPortal(hostSurface, pathname);

  for (const [surface, prefix] of PORTAL_PREFIXES) {
    const below = pathBelow(pathname, prefix);
    if (below) return route(surface, matchers[surface](below));
  }
  return (
    route("public", matchers.public(pathname)) ?? resolveOgs(pathname, true)
  );
}

/**
 * `<Seite> – moto`; a part of the page the address selects follows after a
 * colon: `Kindakte: Notizen – moto`. Each portal has its own address, so the
 * title does not name it.
 */
export function formatPageTitle(parts: {
  readonly page: string;
  readonly section?: string | null;
}): string {
  const section = parts.section?.trim();
  const page =
    section && section !== parts.page
      ? `${parts.page}: ${section}`
      : parts.page;
  return `${page} – ${PAGE_TITLE_BRAND}`;
}

/** The tab title of a resolved page, or null when the page sets its own. */
export function pageTitleText(
  resolved: ResolvedPageTitle | null,
  localized: LocalizedPageTitleMessages,
  section?: string | null,
): string | null {
  if (resolved?.kind === "metadata") return null;
  if (!resolved) return PAGE_TITLE_BRAND;

  const { surface, template } = resolved;
  const key = LOCALIZED_PAGE_TITLES[surface]?.[template];
  const page =
    key !== undefined
      ? localized.pages[key]
      : GERMAN_PAGE_TITLES[surface][template];
  if (page === undefined) return PAGE_TITLE_BRAND;
  return formatPageTitle({ page, section });
}

/**
 * The title surface of a request host, from its portal (`configuredPortalOfHost`):
 * a school's subdomain is the OGS portal, every other host the bare domain.
 */
export function pageTitleSurfaceOf(
  portal: PortalKey,
  hostname: string,
  tenantDomain: string,
): PageTitleSurface {
  if (portal === "parent") return "parents";
  if (portal !== "tenant") return portal;
  const host = hostname.toLowerCase();
  const domain = tenantDomain.toLowerCase().split(":")[0] ?? "";
  return domain !== "" && host.endsWith(`.${domain}`) ? "ogs" : "public";
}
