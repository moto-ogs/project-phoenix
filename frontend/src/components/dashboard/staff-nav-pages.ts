import type { Session } from "next-auth";

import { canReviewGuardianApprovals } from "~/lib/guardian-approval-access";
import { canOpenActiveSupervision } from "~/lib/active-supervision-access";
import { canReadSupervisionData, hasPermission } from "~/lib/auth-utils";
import type { ModuleNavigation } from "~/lib/hooks/use-module-navigation";
import type { ModuleVisibility } from "~/lib/module-register";
import { PLANNING_SUB_PAGES } from "~/lib/planning-navigation";
import {
  COMMUNICATION_SUB_PAGES,
  DATABASE_SUB_PAGES,
  hasAnyDatabasePagePermission,
  PARENT_SUB_PAGES,
  PLANNING_CATALOG_HREFS,
} from "~/lib/section-navigation";

/**
 * Wer welche Katalogseite (Eltern, Team, Planung, Datenverwaltung) sieht.
 * Die Seitenleiste und die Suche (#6954) fragen dieselben Regeln, damit die
 * Suche keine Seite anbietet, die in der Leiste fehlt, und umgekehrt.
 */

/**
 * Regel des Modul-Registers (#4894) für einen Eintrag: `hidden` fällt weg,
 * `locked` ist für die Leitung sichtbar, unabhängig vom Recht der Zielseite:
 * die Erklärung zeigt, dass die Schule das Modul zuerst buchen muss. `open`
 * braucht Recht und Einstellung.
 */
export function moduleGate(
  visibility: ModuleVisibility,
  permitted: boolean,
  settingOn: boolean,
): { readonly show: boolean; readonly locked: boolean } {
  if (visibility === "hidden") {
    return { show: false, locked: false };
  }
  if (visibility === "locked") return { show: true, locked: true };
  if (!permitted) return { show: false, locked: false };
  return { show: settingOn, locked: false };
}

/** Was die Regeln der Katalogseiten über Person und Schule wissen müssen. */
export interface StaffCatalogViewer {
  readonly session: Session | null;
  /** Rolle `admin`. */
  readonly isAdmin: boolean;
  /** Adminzuschnitt, auch über eine Rolle mit allen Rechten. */
  readonly effectiveAdminScope: boolean;
  /** Offene Betreuung: keine festen Gruppen (#1544, #4769). */
  readonly openCareGroupMode: boolean;
  readonly moduleNav: ModuleNavigation;
  /** `timetable.enabled`: Betreuungsplan und Planungsspuren. */
  readonly timetableEnabled: boolean;
  readonly parentNewsEnabled: boolean;
  readonly mealPlanEnabled: boolean;
  readonly staffMessagingEnabled: boolean;
}

/**
 * Planung (#1946). Nicht-Admins sehen nur Seiten mit gehaltener
 * nonAdminPermission (#2283), bei offener Betreuung auch mit
 * openCarePermission (#4769). Nur die Seiten des Betreuungsplans hängen an
 * timetable.enabled; Kalenderzeiträume bleiben erreichbar (Anmeldephasen
 * verknüpfen sich mit ihnen), Dienstplan und Abrechnung folgen ihren Modulen
 * (#4894).
 */
export function planningNavPages(viewer: StaffCatalogViewer) {
  return PLANNING_SUB_PAGES.flatMap((page) => {
    const gate = moduleGate(
      viewer.moduleNav.page(page.href),
      viewer.isAdmin ||
        (page.nonAdminPermission !== undefined &&
          hasPermission(viewer.session, page.nonAdminPermission)) ||
        (viewer.openCareGroupMode &&
          page.openCarePermission !== undefined &&
          hasPermission(viewer.session, page.openCarePermission)),
      !page.requiresTimetable || viewer.timetableEnabled,
    );
    return gate.show ? [{ ...page, locked: gate.locked }] : [];
  });
}

/**
 * Datenverwaltung. Jede Seite trägt das Recht ihrer Route
 * (`DATABASE_PAGE_PERMISSIONS`, derselbe Katalog wie im Guard der Route);
 * ohne es führt der Eintrag nur auf ein 403. Der Adminzuschnitt öffnet alle.
 * Planungsspuren gehören zum Betreuungsplan; ist er ausgeschaltet, gibt es
 * nichts zu ordnen.
 */
export function databaseNavPages(viewer: StaffCatalogViewer) {
  return DATABASE_SUB_PAGES.flatMap((page) => {
    const gate = moduleGate(
      viewer.moduleNav.page(page.href),
      viewer.effectiveAdminScope ||
        hasAnyDatabasePagePermission(viewer.session, page.href),
      !PLANNING_CATALOG_HREFS.has(page.href) || viewer.timetableEnabled,
    );
    return gate.show ? [{ ...page, locked: gate.locked }] : [];
  });
}

/**
 * Eltern: Nachrichten für das Team mit users:read, der Rest je Recht und
 * Schulschalter.
 */
export function parentNavPages(viewer: StaffCatalogViewer) {
  const { session, isAdmin } = viewer;
  return PARENT_SUB_PAGES.flatMap((page) => {
    const rule = ((): readonly [permitted: boolean, settingOn: boolean] => {
      switch (page.feature) {
        case "messages":
          // Elternnachrichten verlangen users:read (#4573: nicht für die
          // AG-Leitung).
          return [isAdmin || hasPermission(session, "users:read"), true];
        case "approvals":
          // Lesen users:manage, Entscheiden users:update (#3469).
          return [canReviewGuardianApprovals(session), true];
        case "announcements":
          // Elternmitteilungen (#1669) schreibt in v1 nur der Adminzuschnitt:
          // jede /api/parent-announcements-Route verlangt admin:*, weil der
          // Dienst die Empfänger nicht nach Person eingrenzt. Ohne das Recht
          // endete jeder Aufruf mit 403.
          return [hasPermission(session, "admin:*"), viewer.parentNewsEnabled];
        case "bankDetails":
          return [hasPermission(session, "guardians:financial"), true];
        case "mealPlan":
          return [
            isAdmin ||
              hasPermission(session, "meals:read") ||
              hasPermission(session, "meals:register"),
            viewer.mealPlanEnabled,
          ];
      }
    })();
    const gate = moduleGate(viewer.moduleNav.page(page.href), ...rule);
    return gate.show ? [{ ...page, locked: gate.locked }] : [];
  });
}

/**
 * Team-interne Seiten: Team-Chat ist Opt-out (operations.
 * staff_messaging_enabled, Default an seit #3254) und fällt trotzdem
 * fail-closed weg, wenn das Flag fehlt; die Tagesinformationen liest, wer
 * users:read hat. Umfragen beantwortet jede Person im Team; die Verwaltung
 * trennt die Seite selbst nach surveys:manage (#4781).
 */
export function communicationNavPages(
  viewer: Pick<StaffCatalogViewer, "session" | "staffMessagingEnabled">,
) {
  return COMMUNICATION_SUB_PAGES.filter((page) => {
    switch (page.feature) {
      case "teamChat":
        return viewer.staffMessagingEnabled;
      case "staffNotices":
        return hasPermission(viewer.session, "users:read");
      case "surveys":
        return true;
    }
  });
}

/** Was die Bereiche „Gruppen“ und „Aktuelle Aufsicht“ entscheiden. */
export interface StaffSectionViewer {
  readonly session: Session | null;
  readonly effectiveAdminScope: boolean;
  readonly openCareGroupMode: boolean;
  readonly isBinaryMode: boolean;
  /** Kinder nur über „Alle Kinder“ (#1321): keine Gruppen und Aufsichten. */
  readonly childSearchOnlyNavigation: boolean;
  /**
   * Die Schule zeigt allen die laufenden Aufsichten. Ein freigegebener Raum
   * (#3065) öffnet den Bereich nicht: er gibt keine Aufsicht.
   */
  readonly overviewEnabled: boolean;
}

/**
 * Gruppen: Team und Adminzuschnitt, nicht bei offener Betreuung. Ein Eintrag
 * führt auf die Auswahlseite (#4351).
 */
export function groupsSectionVisible(viewer: StaffSectionViewer): boolean {
  return (
    (canReadSupervisionData(viewer.session) ||
      viewer.overviewEnabled ||
      viewer.effectiveAdminScope) &&
    !viewer.openCareGroupMode &&
    !viewer.childSearchOnlyNavigation
  );
}

/**
 * Aktuelle Aufsicht: ohne Bedeutung im binären Anwesenheitsmodus, weil es
 * dort keine Raumbesuche gibt. Mit `schedules:read` allein (#4573) zeigt die
 * Seite die eigene laufende Aufsicht.
 */
export function supervisionsSectionVisible(
  viewer: StaffSectionViewer,
): boolean {
  return (
    (viewer.overviewEnabled || canOpenActiveSupervision(viewer.session)) &&
    !viewer.isBinaryMode &&
    !viewer.childSearchOnlyNavigation
  );
}
