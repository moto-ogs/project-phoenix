"use client";

import { useSession } from "next-auth/react";
import { useMemo } from "react";

import {
  communicationNavPages,
  databaseNavPages,
  groupsSectionVisible,
  parentNavPages,
  planningNavPages,
  supervisionsSectionVisible,
} from "~/components/dashboard/staff-nav-pages";
import {
  STAFF_NAV_ITEMS,
  staffNavItemPermitted,
  staffNavSettingOn,
  useStaffNavSettings,
} from "~/components/dashboard/staff-nav-items";
import {
  displayCategoryLabel,
  visibleCategoryItems,
} from "~/components/settings/settings-filter";
import {
  schemaTabsForPage,
  settingsSectionHref,
  settingsSectionsFor,
} from "~/components/settings/settings-nav-items";
import {
  hasEffectiveAdminScope,
  hasPermission,
  hasRole,
  isCaregiver,
  leadsSchool,
} from "~/lib/auth-utils";
import { accountsConcept } from "~/lib/concepts/accounts";
import { databaseConcept } from "~/lib/concepts/database";
import { enrollmentsConcept } from "~/lib/concepts/enrollments";
import { groupsConcept } from "~/lib/concepts/groups";
import { settingsConcept } from "~/lib/concepts/settings";
import { supervisionConcept } from "~/lib/concepts/supervision";
import { useChangeRequestAccess } from "~/lib/hooks/use-change-request-access";
import { useModuleNavigation } from "~/lib/hooks/use-module-navigation";
import { useSchoolParentNewsEnabled } from "~/lib/hooks/use-school-switches";
import { useSettingsSchema } from "~/lib/hooks/use-settings-schema";
import type { MotoConcept } from "~/lib/moto-concepts";
import {
  OGS_GROUPS_LABEL,
  OGS_GROUPS_OVERVIEW_PATH,
} from "~/lib/ogs-groups-navigation";
import { foldForSearch } from "~/lib/search-fold";
import {
  COMMUNICATION_SECTION,
  DATABASE_SECTION,
  ENROLLMENT_SECTION,
  ENROLLMENT_SUB_PAGES,
  PARENT_SECTION,
  PLANNING_SECTION,
  STAFF_FLAT_PAGES,
} from "~/lib/section-navigation";
import { STAFF_NAV_CONCEPTS } from "~/lib/staff-navigation";
import { useOptionalSupervision } from "~/lib/supervision-context";
import {
  useChildSearchOnlyNavigation,
  useMealPlanEnabled,
  useNFCEnabled,
  useOpenCareGroupMode,
  usePresenceMode,
  useStaffMessagingEnabled,
  useTimetableEnabled,
} from "~/lib/tenant-context";

/**
 * Ein Ziel der Suche, das ohne Server gefunden wird: eine Seite, ein Bereich
 * der Einstellungen, eine einzelne Einstellung oder ein Hilfethema.
 */
export interface SearchEntry {
  readonly id: string;
  readonly label: string;
  /** Wo das Ziel steht: „Planung“, „Datenschutz · Automatisch löschen“. */
  readonly context?: string;
  readonly href: string;
  readonly concept: MotoConcept;
  /** Ziele außerhalb der App (die Hilfe) öffnen in einem neuen Tab. */
  readonly newTab?: boolean;
  /** Steht schon ohne Eingabe in der Liste. */
  readonly primary?: boolean;
  /** Name und Ort, gefaltet für den Vergleich. */
  readonly foldedLabel: string;
  readonly foldedContext: string;
  /** Weitere Wörter, die das Ziel finden: Beschreibung, Artikeltext. */
  readonly foldedExtra: string;
}

export function searchEntry(
  entry: Omit<SearchEntry, "foldedLabel" | "foldedContext" | "foldedExtra">,
  extra = "",
): SearchEntry {
  return {
    ...entry,
    foldedLabel: foldForSearch(entry.label),
    foldedContext: foldForSearch(entry.context),
    foldedExtra: foldForSearch(extra),
  };
}

/**
 * Wie gut ein Ziel zum gefalteten Suchtext passt, kleiner ist besser;
 * `null`, wenn es nicht passt. Der Name zählt vor dem Ort und der Ort vor dem
 * übrigen Text, ein Wortanfang vor einer Stelle mitten im Wort.
 */
function entryRank(entry: SearchEntry, folded: string): number | null {
  const { foldedLabel, foldedContext, foldedExtra } = entry;
  if (foldedLabel.startsWith(folded)) return 0;
  if (foldedLabel.includes(` ${folded}`) || foldedLabel.includes(`-${folded}`))
    return 1;
  if (foldedLabel.includes(folded)) return 2;
  if (foldedContext.includes(folded)) return 3;
  if (foldedExtra.includes(folded)) return 4;
  return null;
}

/**
 * Die passenden Ziele, die besten zuerst; bei gleichem Rang bleibt die
 * Reihenfolge des Katalogs. Ohne Suchtext nur die Hauptseiten.
 */
export function matchEntries(
  entries: readonly SearchEntry[],
  query: string,
  limit = Number.POSITIVE_INFINITY,
): readonly SearchEntry[] {
  const folded = foldForSearch(query.trim());
  if (!folded) return entries.filter((entry) => entry.primary);
  const ranked: { entry: SearchEntry; rank: number; index: number }[] = [];
  entries.forEach((entry, index) => {
    const rank = entryRank(entry, folded);
    if (rank !== null) ranked.push({ entry, rank, index });
  });
  ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return ranked.slice(0, limit).map(({ entry }) => entry);
}

/**
 * Die Abschnitte der Profilseite, die jede Person dort sieht: hier stellt sie
 * ihre eigenen Dinge ein. Abschnitte, die nur unter Bedingungen erscheinen
 * (Nachweise, Geburtstag, Nutzungsanalyse), fehlen hier, damit kein Treffer
 * auf eine Seite ohne den Abschnitt führt.
 */
const PROFILE_SECTIONS: readonly { label: string; extra?: string }[] = [
  {
    label: "Persönliche Daten",
    extra: "Name Vorname Nachname Profilbild Foto",
  },
  { label: "Passwort", extra: "Passwort ändern Kennwort" },
  { label: "Benachrichtigungen", extra: "E-Mail Hinweise" },
  {
    label: "Benachrichtigungen auf diesem Gerät",
    extra: "Push Handy Tablet",
  },
  { label: "Passkeys", extra: "Anmelden ohne Passwort Fingerabdruck" },
  {
    label: "Meine vertrauten Geräte",
    extra: "Zwei-Faktor angemeldete Geräte",
  },
];

const PROFILE_HREF = "/profile";
const PROFILE_LABEL = "Mein Profil";

/**
 * Jede Seite der Mitarbeiter-Navigation, die diese Person öffnen kann, mit
 * den Unterseiten der Bereiche Eltern, Team, Planung, Datenverwaltung und
 * Anmeldungen. Es gelten dieselben Regeln wie in der Seitenleiste
 * (`staff-nav-pages.ts`); Seiten eines nicht gebuchten Moduls fehlen, die
 * Seitenleiste zeigt sie der Leitung mit Schloss.
 */
export function useSearchablePages(): readonly SearchEntry[] {
  const { data: session } = useSession();
  const settings = useStaffNavSettings();
  const moduleNav = useModuleNavigation();
  const openCareGroupMode = useOpenCareGroupMode();
  const isBinaryMode = usePresenceMode() === "binary";
  const changeRequestAccess = useChangeRequestAccess();
  const timetableEnabled = useTimetableEnabled();
  const parentNewsEnabled = useSchoolParentNewsEnabled();
  const mealPlanEnabled = useMealPlanEnabled();
  const staffMessagingEnabled = useStaffMessagingEnabled();
  const childSearchOnlyNavigation = useChildSearchOnlyNavigation();
  const { overviewEnabled } = useOptionalSupervision();
  const canOpenRequestsPage = changeRequestAccess.canOpenRequestsPage;

  return useMemo(() => {
    const isAdmin = hasRole(session, "admin");
    const effectiveAdminScope = hasEffectiveAdminScope(session);
    const viewer = {
      session,
      isAdmin,
      isCaregiver: isCaregiver(session),
      openCareGroupMode,
    };
    const catalogViewer = {
      session,
      isAdmin,
      effectiveAdminScope,
      openCareGroupMode,
      moduleNav,
      timetableEnabled,
      parentNewsEnabled,
      mealPlanEnabled,
      staffMessagingEnabled,
    };
    const sectionViewer = {
      session,
      effectiveAdminScope,
      openCareGroupMode,
      isBinaryMode,
      childSearchOnlyNavigation,
      overviewEnabled,
    };

    const entries = new Map<string, SearchEntry>();
    const add = (
      page: {
        readonly href: string;
        readonly label: string;
        readonly locked?: boolean;
      },
      concept: MotoConcept | undefined,
      context?: string,
      options: { primary?: boolean; newTab?: boolean } = {},
    ) => {
      if (page.locked || entries.has(page.href)) return;
      entries.set(
        page.href,
        searchEntry({
          id: `page-${page.href}`,
          label: page.label,
          context,
          href: page.href,
          concept: concept ?? settingsConcept,
          ...options,
        }),
      );
    };

    // Die Seiten mit eigenem Eintrag, wie in der Seitenleiste. Anfragen
    // (#2429/#2911) braucht zusätzlich den serverseitigen Prüfbereich.
    for (const item of STAFF_NAV_ITEMS) {
      if (isBinaryMode && item.binaryHidden) continue;
      if (moduleNav.page(item.href) !== "open") continue;
      const permitted =
        item.href === STAFF_FLAT_PAGES.anfragen.href
          ? canOpenRequestsPage
          : staffNavSettingOn(item, settings) &&
            staffNavItemPermitted(item, viewer);
      if (!permitted) continue;
      add(item, item.concept, undefined, {
        primary: true,
        newTab: item.newTab,
      });
    }

    if (groupsSectionVisible(sectionViewer)) {
      add(
        { href: OGS_GROUPS_OVERVIEW_PATH, label: OGS_GROUPS_LABEL },
        groupsConcept,
      );
    }
    if (supervisionsSectionVisible(sectionViewer)) {
      add(
        { href: "/active-supervisions", label: "Aktuelle Aufsicht" },
        supervisionConcept,
      );
    }
    for (const page of parentNavPages(catalogViewer)) {
      add(page, STAFF_NAV_CONCEPTS[page.href], PARENT_SECTION.label);
    }
    if (leadsSchool(session) && moduleNav.section("enrollments") === "open") {
      for (const page of ENROLLMENT_SUB_PAGES) {
        add(page, enrollmentsConcept, ENROLLMENT_SECTION.label);
      }
    }
    for (const page of communicationNavPages(catalogViewer)) {
      add(page, STAFF_NAV_CONCEPTS[page.href], COMMUNICATION_SECTION.label);
    }
    for (const page of planningNavPages(catalogViewer)) {
      add(page, STAFF_NAV_CONCEPTS[page.href], PLANNING_SECTION.label);
    }
    const databasePages = databaseNavPages(catalogViewer);
    if (databasePages.some((page) => !page.locked)) {
      add(DATABASE_SECTION, databaseConcept);
    }
    for (const page of databasePages) {
      add(page, databaseConcept, DATABASE_SECTION.label);
    }
    return [...entries.values()];
  }, [
    session,
    settings,
    moduleNav,
    openCareGroupMode,
    isBinaryMode,
    canOpenRequestsPage,
    timetableEnabled,
    parentNewsEnabled,
    mealPlanEnabled,
    staffMessagingEnabled,
    childSearchOnlyNavigation,
    overviewEnabled,
  ]);
}

/**
 * Die Einstellungen als Ziele: die eigenen Abschnitte im Profil für jede
 * Person, für Konten, die die Einstellungen der Schule lesen, deren Bereiche
 * und jede einzelne Einstellung. Ein Treffer öffnet den Bereich und markiert
 * die Einstellung (`?highlight=`). Das Schema lädt erst, wenn die Suche offen
 * ist, und kommt danach aus dem Cache.
 */
export function useSearchableSettings(
  enabled: boolean,
): readonly SearchEntry[] {
  const { data: session } = useSession();
  const canReadSettings =
    hasPermission(session, "config:read") ||
    hasPermission(session, "config:manage");
  const { data: schema } = useSettingsSchema(enabled && canReadSettings);
  const nfcEnabled = useNFCEnabled();
  const canManageHomeBlocks = hasPermission(session, "config:update");

  return useMemo(() => {
    const entries: SearchEntry[] = PROFILE_SECTIONS.map((section) =>
      searchEntry(
        {
          id: `profile-${section.label}`,
          label: section.label,
          context: PROFILE_LABEL,
          href: PROFILE_HREF,
          concept: accountsConcept,
        },
        section.extra,
      ),
    );
    if (!canReadSettings || !schema) return entries;

    const settingsLabel = STAFF_FLAT_PAGES.settings.label;
    const sections = settingsSectionsFor(schema, {
      schemaFailed: false,
      nfcEnabled,
      canManageHomeBlocks,
    });
    for (const section of sections) {
      entries.push(
        searchEntry({
          id: section.id,
          label: section.label,
          context: settingsLabel,
          href: settingsSectionHref(section.id),
          concept: section.icon,
        }),
      );
    }
    const iconOf = new Map(
      sections.map((section) => [section.id, section.icon]),
    );
    for (const tab of schemaTabsForPage(schema, nfcEnabled)) {
      const tabSection = sections.find(
        (section) => section.id === `settings-${tab.key}`,
      );
      if (!tabSection) continue;
      for (const category of tab.categories) {
        for (const item of visibleCategoryItems(category)) {
          entries.push(
            searchEntry(
              {
                id: `setting-${item.key}`,
                label: item.label,
                context: `${tabSection.label} · ${displayCategoryLabel(category)}`,
                href: `/settings?${new URLSearchParams({
                  tab: tab.key,
                  highlight: item.key,
                }).toString()}`,
                concept: iconOf.get(tabSection.id) ?? settingsConcept,
              },
              item.description,
            ),
          );
        }
      }
    }
    return entries;
  }, [canReadSettings, schema, nfcEnabled, canManageHomeBlocks]);
}
