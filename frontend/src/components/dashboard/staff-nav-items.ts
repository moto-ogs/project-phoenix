import type { MotoConcept } from "~/lib/moto-concepts";
import type { Session } from "next-auth";
import { useMemo } from "react";
import {
  hasEffectiveAdminScope,
  hasPermission,
  hasRole,
  isCaregiver,
} from "~/lib/auth-utils";
import { useChangeRequestAccess } from "~/lib/hooks/use-change-request-access";
import { useHasOwnStaff } from "~/lib/hooks/use-user-context";
import {
  useModuleNavigation,
  type ModuleNavigation,
} from "~/lib/hooks/use-module-navigation";
import { useSchoolParentNewsEnabled } from "~/lib/hooks/use-school-switches";
import type { ModuleVisibility } from "~/lib/module-register";
import { PLANNING_SUB_PAGES } from "~/lib/planning-navigation";
import { STUDENT_READ_PERMISSIONS } from "~/lib/student-access";
import {
  COMMUNICATION_SUB_PAGES,
  PARENT_SUB_PAGES,
  STAFF_FLAT_PAGES,
} from "~/lib/section-navigation";
import {
  useAttendanceLogEnabled,
  useDisplayEnabled,
  useMealPlanEnabled,
  useOpenCareGroupMode,
  usePresenceMode,
  useStaffMessagingEnabled,
  useTimetableEnabled,
} from "~/lib/tenant-context";
import {
  communicationPageRule,
  moduleGate,
  parentPageRule,
  planningPageRule,
  type StaffCatalogViewer,
} from "./staff-nav-pages";
import { activitiesConcept } from "~/lib/concepts/activities";
import { calendarConcept } from "~/lib/concepts/calendar";
import { carePlanConcept } from "~/lib/concepts/carePlan";
import { childrenConcept } from "~/lib/concepts/children";
import { dashboardConcept } from "~/lib/concepts/dashboard";
import { dayReportConcept } from "~/lib/concepts/dayReport";
import { emergencyConcept } from "~/lib/concepts/emergency";
import { filesConcept } from "~/lib/concepts/files";
import { groupAccessConcept } from "~/lib/concepts/groupAccess";
import { helpConcept } from "~/lib/concepts/help";
import { holidayWeeksConcept } from "~/lib/concepts/holidayWeeks";
import { infoDisplaysConcept } from "~/lib/concepts/infoDisplays";
import { payrollConcept } from "~/lib/concepts/payroll";
import { reportsConcept } from "~/lib/concepts/reports";
import { requestsConcept } from "~/lib/concepts/requests";
import { roomsConcept } from "~/lib/concepts/rooms";
import { settingsConcept } from "~/lib/concepts/settings";
import { staffConcept } from "~/lib/concepts/staff";
import { staffPlanConcept } from "~/lib/concepts/staffPlan";
import { timeTrackingConcept } from "~/lib/concepts/timeTracking";

/**
 * Die Seiten der Mitarbeiter-Navigation mit eigenem Eintrag (#6580):
 * Seitenleiste und „Mehr“-Menü der mobilen Leiste lesen Name, Bild, Recht,
 * Schulschalter und Aktiv-Regel jeder Seite aus dieser einen Liste. Vorher
 * führte jede ihre eigene Kopie.
 *
 * Wo eine Seite steht (Gruppe, Reihenfolge), entscheidet der Baum in
 * `~/lib/staff-navigation`; eine Seite, die dort fehlt, erscheint nirgends.
 * Die Katalogseiten der Gruppen Eltern, Team und Planung kommen aus ihren
 * Katalogen (`section-navigation.ts`, `planning-navigation.ts`).
 *
 * Was die beiden Flächen bewusst unterscheidet, steht bei ihnen: die Reiter
 * der mobilen Leiste mit Kurznamen („Start“, „Suchen“) und die Regeln für
 * Seiten aus einem nicht gebuchten Modul. Die übrigen Abweichungen hält
 * #6708 fest.
 */

/** Ein Schulschalter, ohne den die Seite keinen Eintrag hat. */
export type StaffNavSetting = "timetable" | "display" | "attendanceLog";

export interface StaffNavItem {
  readonly href: string;
  readonly label: string;
  readonly concept: MotoConcept;
  /** Für jede Person mit Zugang zur Schule. */
  readonly alwaysShow?: boolean;
  /**
   * Das Recht der Route; eines davon genügt (wie `RequiresAnyPermission`).
   * Admins sehen den Eintrag immer.
   */
  readonly requiresPermission?: string | readonly string[];
  /** Alle Rechte der Route (wie `RequiresAllPermissions`). */
  readonly requiresAllPermissions?: readonly string[];
  /** Nur für die Rolle Admin (Planungsseiten ohne Recht für andere). */
  readonly requiresAdmin?: boolean;
  /** Bei offener Betreuung öffnet auch dieses Recht die Seite (#4769). */
  readonly openCarePermission?: string;
  /** Ein Einstieg der Betreuungskräfte, den Admins nicht brauchen. */
  readonly hideForAdmin?: boolean;
  readonly setting?: StaffNavSetting;
  /**
   * Raum- und Besuchsseiten ohne Bedeutung im binären Anwesenheitsmodus
   * (#2915); der BinaryModeGuard sperrt sie, auch eine Leitung sieht dort
   * kein Schloss.
   */
  readonly binaryHidden?: boolean;
  /** Ziele außerhalb der App (die Hilfe) öffnen in einem neuen Tab. */
  readonly newTab?: boolean;
  /**
   * Die Seite zeigt die eigenen Zeiten oder Termine und braucht ein
   * Personalprofil in dieser Schule. Ohne Profil fehlt der Eintrag, auch für
   * Admins und Personen des Trägers (#7306).
   */
  readonly requiresOwnStaff?: boolean;
}

export const STAFF_NAV_ITEMS: readonly StaffNavItem[] = [
  {
    // Startseite aller Rollen (#2180): sie setzt sich aus Bausteinen
    // zusammen, die jeder für sich am Recht der Person hängen. Deshalb steht
    // der Eintrag für alle da, auch für eine Rolle, die nur einen Baustein
    // sieht.
    ...STAFF_FLAT_PAGES.dashboard,
    concept: dashboardConcept,
    alwaysShow: true,
  },
  {
    // Tages-Betreuungsplan (#2383): Einstieg der Betreuungskräfte in den
    // laufenden Tag. Für Admins versteckt, sie haben den vollen
    // Betreuungsplan im Planungsbereich. schedules:read ist das Gate der
    // Route (/timetable/operations/planned-now); ohne das Recht wäre der
    // Eintrag nur ein sicherer 403. Nur an Schulen mit Betreuungsplan; das
    // Flag kommt vom Tenant-Resolve und ist auch ohne config:read da.
    ...STAFF_FLAT_PAGES.tagesplan,
    concept: carePlanConcept,
    requiresPermission: "schedules:read",
    hideForAdmin: true,
    setting: "timetable",
    binaryHidden: true,
  },
  {
    // Alle Kinder liest das Schülerverzeichnis: users:read oder, für die
    // Rolle „Gast“, students:read (ADR 0091). Ohne beides, etwa als
    // AG-Leitung, wäre der Eintrag eine Sackgasse.
    ...STAFF_FLAT_PAGES.studentSearch,
    concept: childrenConcept,
    requiresPermission: STUDENT_READ_PERMISSIONS,
  },
  {
    // Dasselbe Recht wie GET /api/activities (#4573, AG-Leitung).
    ...STAFF_FLAT_PAGES.activities,
    concept: activitiesConcept,
    requiresPermission: ["activities:list", "activities:read"],
    binaryHidden: true,
  },
  {
    // Dasselbe Recht wie GET /api/rooms (#4573, AG-Leitung).
    ...STAFF_FLAT_PAGES.rooms,
    concept: roomsConcept,
    requiresPermission: "rooms:read",
    binaryHidden: true,
  },
  {
    // Dasselbe Recht wie GET /api/staff (#4573, AG-Leitung).
    ...STAFF_FLAT_PAGES.staff,
    concept: staffConcept,
    requiresPermission: ["users:read", "staff:manage", "staff:stammdaten"],
  },
  {
    // Das Backend prüft GET /api/calendar/my mit calendar:own; ohne das Recht
    // landete eine eingeschränkte Rolle auf einer 403-Seite.
    ...STAFF_FLAT_PAGES.calendar,
    concept: calendarConcept,
    requiresPermission: "calendar:own",
    requiresOwnStaff: true,
  },
  {
    // Gemeinsame Übersicht für Gruppenübergaben, Terminvertretungen und
    // zusätzliche Aufsichten. Die Seite öffnet nur mit substitutions:read
    // (#4573, AG-Leitung); einzelne Aktionen prüft der Server.
    ...STAFF_FLAT_PAGES.substitutions,
    concept: groupAccessConcept,
    requiresPermission: "substitutions:read",
  },
  {
    // Info-Displays sind Opt-in (display.enabled, Standard aus).
    ...STAFF_FLAT_PAGES.infoDisplays,
    concept: infoDisplaysConcept,
    requiresPermission: ["display:read", "display:manage"],
    setting: "display",
  },
  {
    // Die eigene Zeiterfassung liest das Backend nur mit time_tracking:own;
    // externe Kräfte (#4573) erfassen keine Arbeitszeit.
    ...STAFF_FLAT_PAGES.timeTracking,
    concept: timeTrackingConcept,
    requiresPermission: "time_tracking:own",
    requiresOwnStaff: true,
  },
  {
    // Eigener Dienstplan (#3821): die Route liest nur über time_tracking:own.
    ...STAFF_FLAT_PAGES.ownShiftPlan,
    concept: staffPlanConcept,
    requiresPermission: "time_tracking:own",
    requiresOwnStaff: true,
  },
  {
    // Tagesauswertung (#1456): rückwirkender Tagesstatus pro Gruppe. Opt-in
    // über gdpr.attendance_log_enabled (Standard aus).
    ...STAFF_FLAT_PAGES.dayLog,
    concept: dayReportConcept,
    requiresPermission: "users:read",
    setting: "attendanceLog",
  },
  {
    // Anfragen-Modul (#2429): Wünsche von Eltern und Mitarbeitenden an einem
    // Ort. Die Sichtbarkeit hängt an zwei getrennten Rechte-Regeln
    // (Eltern-Reiter, Mitarbeitende-Reiter) und am serverseitigen
    // Prüfbereich; beide Flächen fragen dafür `canOpenRequestsPage`.
    ...STAFF_FLAT_PAGES.anfragen,
    concept: requestsConcept,
  },
  {
    // Dateiablage (#2596): jeder mit Tenant-Zugang sieht den Eintrag; welche
    // Ordner sichtbar sind, entscheidet das Backend pro Ordner.
    ...STAFF_FLAT_PAGES.dateien,
    concept: filesConcept,
    alwaysShow: true,
  },
  {
    // Statistik (#2606): Anwesenheitsquoten je Kind, Gruppe und Zeitraum
    // plus Raumauslastung. Das Backend verlangt config:read UND users:read.
    ...STAFF_FLAT_PAGES.statistics,
    concept: reportsConcept,
    requiresAllPermissions: ["config:read", "users:read"],
  },
  {
    // Lohnabrechnung (#6670 aus der Planung in die Verwaltung): die Routen
    // schreibt das Backend mit config:manage, dasselbe Recht wie zuvor im
    // Planungskatalog.
    ...STAFF_FLAT_PAGES.payroll,
    concept: payrollConcept,
    requiresPermission: "config:manage",
  },
  {
    // Ferienwochen (#4665): Teilnehmerliste der ausrichtenden OGS. Das
    // Backend verlangt config:read wie die Anmeldelisten.
    ...STAFF_FLAT_PAGES.holidayWeeks,
    concept: holidayWeeksConcept,
    requiresPermission: "config:read",
  },
  {
    // Die Notfallliste exportiert das Backend nur mit users:read (#4573,
    // AG-Leitung).
    ...STAFF_FLAT_PAGES.emergency,
    concept: emergencyConcept,
    requiresPermission: "users:read",
  },
  {
    ...STAFF_FLAT_PAGES.help,
    concept: helpConcept,
    alwaysShow: true,
    newTab: true,
  },
  {
    // Die Einstellungen schreibt das Backend mit config:manage; dasselbe
    // Recht öffnet den Eintrag für eine Leitungsrolle der Schule (#3469).
    ...STAFF_FLAT_PAGES.settings,
    concept: settingsConcept,
    requiresPermission: "config:manage",
  },
];

export const STAFF_NAV_ITEMS_BY_HREF: ReadonlyMap<string, StaffNavItem> =
  new Map(STAFF_NAV_ITEMS.map((item) => [item.href, item]));

/** Seiten, die im binären Anwesenheitsmodus keinen Eintrag haben. */
export const STAFF_NAV_BINARY_HIDDEN_HREFS: ReadonlySet<string> = new Set(
  STAFF_NAV_ITEMS.filter((item) => item.binaryHidden).map((item) => item.href),
);

/** Wer die Navigation sieht. */
export interface StaffNavViewer {
  readonly session: Session | null;
  /** Rolle `admin`. */
  readonly isAdmin: boolean;
  readonly isCaregiver: boolean;
  /** Offene Betreuung: keine festen Gruppen (#1544, #4769). */
  readonly openCareGroupMode: boolean;
  /**
   * Die Person hat in dieser Schule ein Personalprofil. Nur `false`, wenn der
   * Kontext vollständig geladen ist und keines nennt (`useHasOwnStaff`).
   */
  readonly hasOwnStaff: boolean;
}

/** Ein Einstieg der Betreuungskräfte, den eine Admin-Rolle nicht sieht. */
function staffNavHiddenForAdmin(
  item: Pick<StaffNavItem, "hideForAdmin">,
  viewer: StaffNavViewer,
): boolean {
  return item.hideForAdmin === true && viewer.isAdmin && !viewer.isCaregiver;
}

/**
 * Darf die Person die Seite öffnen? Prüft die Rechte des Eintrags; ob die
 * Seite zu einem gebuchten Modul gehört und ob ihr Schulschalter an ist,
 * entscheiden `moduleGate` und `staffNavSettingOn`.
 */
export function staffNavItemPermitted(
  item: Omit<StaffNavItem, "href" | "label" | "concept">,
  viewer: StaffNavViewer,
): boolean {
  if (staffNavHiddenForAdmin(item, viewer)) return false;
  if (item.alwaysShow) return true;
  // Vor der Admin-Abkürzung: auch Admins haben ohne Personalprofil keine
  // eigenen Zeiten und Termine (#7306).
  if (item.requiresOwnStaff && !viewer.hasOwnStaff) return false;
  if (viewer.isAdmin) return true;
  if (item.requiresAdmin) return false;
  if (
    viewer.openCareGroupMode &&
    item.openCarePermission !== undefined &&
    hasPermission(viewer.session, item.openCarePermission)
  ) {
    return true;
  }
  if (item.requiresPermission !== undefined) {
    const required =
      typeof item.requiresPermission === "string"
        ? [item.requiresPermission]
        : item.requiresPermission;
    if (!required.some((p) => hasPermission(viewer.session, p))) return false;
  }
  if (
    item.requiresAllPermissions &&
    !item.requiresAllPermissions.every((p) => hasPermission(viewer.session, p))
  ) {
    return false;
  }
  return true;
}

/**
 * Die Schulschalter der Navigation, vom Tenant-Resolve: auch ohne
 * config:read aufgelöst, ohne das ganze Settings-Schema.
 */
export function useStaffNavSettings(): Readonly<
  Record<StaffNavSetting, boolean>
> {
  return {
    timetable: useTimetableEnabled(),
    display: useDisplayEnabled(),
    attendanceLog: useAttendanceLogEnabled(),
  };
}

/**
 * Wie eine Seite in der Navigation erscheint: offen, mit Schloss (Modul nicht
 * gebucht, #4894) oder gar nicht (`null`).
 */
export type StaffNavPageState = "open" | "locked" | null;

/**
 * Wo Seitenleiste und mobile Leiste heute verschieden entscheiden. Jede
 * Fläche nennt ihren Wert beim Aufruf; die Abweichungen hält #6708 fest.
 */
export interface StaffNavPageRules {
  /**
   * „Heute“ verlangt das Recht der Route (schedules:read) auch von der Rolle
   * Admin. Die mobile Leiste prüft es, die Seitenleiste lässt es dort aus.
   */
  readonly tagesplanRouteRightForAdmins: boolean;
  /**
   * „Hinweise der Leitung“ steht der Rolle Admin auch ohne users:read offen.
   * Die mobile Leiste lässt die Rolle durch, die Seitenleiste prüft nur das
   * Recht.
   */
  readonly staffNoticesOpenForAdminRole: boolean;
  /**
   * Ob die Schulschalter (Elternmitteilungen) geladen werden. Die mobile
   * Leiste fragt sie nur im Mitarbeiter-Portal.
   */
  readonly loadSchoolSwitches: boolean;
}

/** Was die Seitenregeln über Person und Schule wissen müssen. */
export interface StaffNavPageInputs {
  readonly viewer: StaffNavViewer;
  /** Das Modul-Register (#4894) für die Seite hinter `href`. */
  readonly modulePage: (href: string) => ModuleVisibility;
  readonly isBinaryMode: boolean;
  readonly settings: Readonly<Record<StaffNavSetting, boolean>>;
  readonly canOpenRequestsPage: boolean;
  readonly staffMessagingEnabled: boolean;
  readonly parentNewsEnabled: boolean;
  readonly mealPlanEnabled: boolean;
}

const PARENT_SUB_PAGES_BY_HREF = new Map(
  PARENT_SUB_PAGES.map((page) => [page.href, page]),
);
const COMMUNICATION_SUB_PAGES_BY_HREF = new Map(
  COMMUNICATION_SUB_PAGES.map((page) => [page.href, page]),
);
const PLANNING_SUB_PAGES_BY_HREF: ReadonlyMap<
  string,
  (typeof PLANNING_SUB_PAGES)[number]
> = new Map(PLANNING_SUB_PAGES.map((page) => [page.href, page]));

/**
 * Recht und Schulschalter einer Seite mit eigenem Eintrag: aus der Liste
 * oben oder aus den Katalogen der Gruppen Eltern, Team und Planung.
 * `undefined` für eine Adresse ohne solchen Eintrag.
 */
function staffNavPageRule(
  href: string,
  inputs: StaffNavPageInputs,
  rules: StaffNavPageRules,
): readonly [permitted: boolean, settingOn: boolean] | undefined {
  const { viewer } = inputs;
  const session = viewer.session;
  const item = STAFF_NAV_ITEMS_BY_HREF.get(href);
  if (item) {
    // Anfragen (#2429/#2911): JWT-Rechte allein reichen nicht. Für
    // Elternanfragen muss zusätzlich der aktuelle serverseitige Prüfbereich
    // (Admin, Gruppenleitung oder Vertretung) gelten.
    if (item.href === STAFF_FLAT_PAGES.anfragen.href) {
      return [inputs.canOpenRequestsPage, true];
    }
    // Der Schulschalter zählt hier als Teil des Rechts: eine Seite mit
    // Schloss erklärt das Modul auch bei ausgeschaltetem Schalter.
    const permitted =
      staffNavSettingOn(item, inputs.settings) &&
      staffNavItemPermitted(item, viewer) &&
      !(
        rules.tagesplanRouteRightForAdmins &&
        item.href === STAFF_FLAT_PAGES.tagesplan.href &&
        !hasPermission(session, "schedules:read")
      );
    return [permitted, true];
  }
  // Die Regeln der Katalogseiten stehen in staff-nav-pages.ts, damit
  // Seitenleiste, mobile Leiste und Suche dieselben lesen.
  const catalogViewer = {
    session,
    isAdmin: viewer.isAdmin,
    openCareGroupMode: viewer.openCareGroupMode,
    timetableEnabled: inputs.settings.timetable,
    parentNewsEnabled: inputs.parentNewsEnabled,
    mealPlanEnabled: inputs.mealPlanEnabled,
    staffMessagingEnabled: inputs.staffMessagingEnabled,
  };
  const parentPage = PARENT_SUB_PAGES_BY_HREF.get(href);
  if (parentPage) return parentPageRule(parentPage, catalogViewer);
  const communicationPage = COMMUNICATION_SUB_PAGES_BY_HREF.get(href);
  if (communicationPage) {
    const rule = communicationPageRule(communicationPage, catalogViewer);
    return communicationPage.feature === "staffNotices" &&
      rules.staffNoticesOpenForAdminRole &&
      viewer.isAdmin
      ? [true, rule[1]]
      : rule;
  }
  const planningPage = PLANNING_SUB_PAGES_BY_HREF.get(href);
  if (planningPage) return planningPageRule(planningPage, catalogViewer);
  return undefined;
}

/** Wie die Seite hinter `href` erscheint; `null` auch für fremde Adressen. */
export function staffNavPageState(
  href: string,
  inputs: StaffNavPageInputs,
  rules: StaffNavPageRules,
): StaffNavPageState {
  // Der Binärmodus schließt diese Seiten vollständig aus. Auch eine Leitung
  // sieht hier kein Schloss, weil die Zielseite nicht erklärt, sondern als
  // nicht passende Anwesenheitsart gesperrt ist.
  if (inputs.isBinaryMode && STAFF_NAV_BINARY_HIDDEN_HREFS.has(href)) {
    return null;
  }
  const rule = staffNavPageRule(href, inputs, rules);
  if (!rule) return null;
  const gate = moduleGate(inputs.modulePage(href), ...rule);
  if (!gate.show) return null;
  return gate.locked ? "locked" : "open";
}

export interface StaffNavPages {
  /** Wie die Seite hinter `href` erscheint; `null` auch für fremde Adressen. */
  readonly pageState: (href: string) => StaffNavPageState;
  readonly viewer: StaffNavViewer;
  readonly moduleNav: ModuleNavigation;
  readonly isBinaryMode: boolean;
  readonly timetableEnabled: boolean;
  /**
   * Dieselben Schulschalter für die Kataloglisten aus staff-nav-pages.ts,
   * damit eine Fläche die Hooks nicht ein zweites Mal ruft.
   */
  readonly catalogViewer: StaffCatalogViewer;
}

/**
 * Welche Seiten der Mitarbeiter-Navigation die Person an dieser Schule sieht,
 * offen oder mit Schloss. Seitenleiste und mobile Leiste fragen beide hier;
 * eine neue Regel kommt nur hierher.
 */
export function useStaffNavPages(
  session: Session | null,
  rules: StaffNavPageRules,
): StaffNavPages {
  const moduleNav = useModuleNavigation();
  const isBinaryMode = usePresenceMode() === "binary";
  const settings = useStaffNavSettings();
  const openCareGroupMode = useOpenCareGroupMode();
  const staffMessagingEnabled = useStaffMessagingEnabled();
  const parentNewsEnabled = useSchoolParentNewsEnabled(
    rules.loadSchoolSwitches,
  );
  const mealPlanEnabled = useMealPlanEnabled();
  const { canOpenRequestsPage } = useChangeRequestAccess();
  const hasOwnStaff = useHasOwnStaff(rules.loadSchoolSwitches);
  const isAdmin = hasRole(session, "admin");
  const effectiveAdminScope = hasEffectiveAdminScope(session);
  const viewer: StaffNavViewer = {
    session,
    isAdmin,
    isCaregiver: isCaregiver(session),
    openCareGroupMode,
    hasOwnStaff,
  };
  // Stabil, solange sich nichts ändert: die Seitenleiste merkt sich ihre
  // Kataloglisten an diesem Objekt.
  const catalogViewer: StaffCatalogViewer = useMemo(
    () => ({
      session,
      isAdmin,
      effectiveAdminScope,
      openCareGroupMode,
      moduleNav,
      timetableEnabled: settings.timetable,
      parentNewsEnabled,
      mealPlanEnabled,
      staffMessagingEnabled,
    }),
    [
      session,
      isAdmin,
      effectiveAdminScope,
      openCareGroupMode,
      moduleNav,
      settings.timetable,
      parentNewsEnabled,
      mealPlanEnabled,
      staffMessagingEnabled,
    ],
  );
  const inputs: StaffNavPageInputs = {
    viewer,
    modulePage: moduleNav.page,
    isBinaryMode,
    settings,
    canOpenRequestsPage,
    staffMessagingEnabled,
    parentNewsEnabled,
    mealPlanEnabled,
  };
  return {
    pageState: (href) => staffNavPageState(href, inputs, rules),
    viewer,
    moduleNav,
    isBinaryMode,
    timetableEnabled: settings.timetable,
    catalogViewer,
  };
}

/** Ist der Schulschalter der Seite an? Seiten ohne Schalter: immer. */
export function staffNavSettingOn(
  item: Pick<StaffNavItem, "setting">,
  settings: Readonly<Record<StaffNavSetting, boolean>>,
): boolean {
  return item.setting === undefined || settings[item.setting];
}

/**
 * Die Aktiv-Regel einer Seite ohne Sonderfall: der Pfad beginnt mit ihrer
 * Adresse. Mein Kalender braucht den genauen Pfad, sonst leuchtet er auf
 * /calendar-periods (Planung) mit.
 */
export function staffNavPathActive(href: string, pathname: string): boolean {
  if (href === STAFF_FLAT_PAGES.calendar.href) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }
  return pathname.startsWith(href);
}

/**
 * Seiten, die ein anderer Eintrag markiert als ihr eigener Pfad: ein offener
 * Raum ohne eigene Aufsicht gehört zu „Räume“ (#4372), „Unterwegs“ aus „Alle
 * Kinder“ heraus zu „Alle Kinder“ (#5026). `null`, wenn die Regel nicht
 * greift.
 */
export function staffNavBorrowedActiveHref(
  pathname: string,
  from: string | null,
  viewingSharedOpenRoom: boolean,
): string | null {
  if (viewingSharedOpenRoom) return STAFF_FLAT_PAGES.rooms.href;
  if (
    pathname === "/rooms/unterwegs" &&
    from?.startsWith(STAFF_FLAT_PAGES.studentSearch.href)
  ) {
    return STAFF_FLAT_PAGES.studentSearch.href;
  }
  return null;
}
