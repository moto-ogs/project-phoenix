"use client";

import { Menu } from "lucide-react";

import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  PortalOverflowBottomNav,
  type PortalOverflowNavItem,
} from "~/components/ui/portal-overflow-bottom-nav";
import { moreConcept } from "~/lib/concepts/more";
import { traegerPath } from "~/lib/traeger-url";
import {
  isTraegerNavActive,
  isTraegerSettingsPath,
} from "./traeger-nav-active";
import { ModuleLockMark } from "~/components/ui/module-lock-mark";
import type { ModuleKey } from "~/lib/modules";
import { TRAEGER_MODULE_LOCK_TITLE } from "~/lib/traeger-modules";
import {
  TRAEGER_BACK_NAV,
  TRAEGER_HELP_NAV,
  TRAEGER_SETTINGS_NAV,
  traegerNavGroupsFor,
  traegerSettingsNavItemsFor,
  type TraegerNavItem,
} from "./traeger-nav-items";
import { useTraegerReturnHref } from "./traeger-return-path";
import { TRAEGER_SEARCH_LABEL, useOpenTraegerSearch } from "./traeger-search";

type BottomNavItem = Omit<TraegerNavItem, "right"> & {
  readonly help?: true;
  /** Das Ziel ist schon eine fertige Adresse und nie die aktuelle Seite. */
  readonly direct?: true;
};

const HELP_ITEM: BottomNavItem = {
  ...TRAEGER_HELP_NAV,
  help: true,
  direct: true,
};

/**
 * Die mobile Hauptnavigation des Träger-Portals (#5145): die geteilte
 * `PortalBottomNav` des Schul-Portals mit den Zielen, die die Rechte der
 * Person öffnen. Sie folgt der Seitenleiste (#5685): erst die Hauptnavigation
 * mit Hilfe und Einstellungen, in den Einstellungen deren Einträge mit dem
 * Rückweg zur App vorne.
 */
export function TraegerBottomNav({
  federalStates,
  bookedModules = null,
}: {
  /** Die Bundesländer der Schulen des Trägers, wie in der Seitenleiste (#4717). */
  readonly federalStates?: readonly string[];
  /** Die gebuchten moto-Module des Trägers, wie in der Seitenleiste (#6052). */
  readonly bookedModules?: readonly ModuleKey[] | null;
}) {
  const pathname = usePathname() ?? "";
  const { data: session } = useSession();
  const returnHref = useTraegerReturnHref();
  const openSearch = useOpenTraegerSearch();

  const settingsItems = traegerSettingsNavItemsFor(
    session ?? null,
    bookedModules,
  );
  const settingsEntry = settingsItems[0];
  const inSettings = isTraegerSettingsPath(pathname);
  const items: readonly BottomNavItem[] = inSettings
    ? [
        { ...TRAEGER_BACK_NAV, href: returnHref, direct: true },
        ...settingsItems,
      ]
    : [
        // Die Leiste folgt der Seitenleiste (#5685); was nicht passt,
        // steht unter „Mehr“.
        ...traegerNavGroupsFor(
          session ?? null,
          federalStates,
          bookedModules,
        ).flatMap((group) => group.items),
        HELP_ITEM,
        ...(settingsEntry
          ? [{ ...TRAEGER_SETTINGS_NAV, href: settingsEntry.href }]
          : []),
      ];
  const navItems: readonly PortalOverflowNavItem[] = items.map((item) => ({
    key: item.key,
    href: item.direct ? item.href : traegerPath(item.href),
    label: item.label,
    shortLabel: "shortLabel" in item ? item.shortLabel : undefined,
    concept: item.concept,
    active: item.direct !== true && isTraegerNavActive(item.href, pathname),
    newTab: item.help === true,
    // Die Hilfe ist kein Arbeitsbereich: eine Linie trennt sie ab, wie unten
    // in der Seitenleiste.
    separated: item.help === true,
    // Ein nicht gebuchtes moto-Modul steht mit Schloss unter „Mehr“ (#6052).
    mark:
      "locked" in item && item.locked ? (
        <ModuleLockMark title={TRAEGER_MODULE_LOCK_TITLE} />
      ) : undefined,
  }));

  return (
    <PortalOverflowBottomNav
      items={navItems}
      moreConcept={moreConcept}
      navItemAttribute="data-traeger-nav-item"
      activeInMore
      // Die Lupe öffnet die Suche nach Seiten und Schulen (#7648); in den
      // Einstellungen bleibt die Leiste wie bisher.
      search={
        openSearch && !inSettings
          ? { label: TRAEGER_SEARCH_LABEL, onOpen: openSearch }
          : undefined
      }
      // Wie im OGS-Portal: die Hauptleiste zeigt die drei Striche des
      // Menüs; die Einstellungsleiste behält die Punkte wie dort.
      moreIcon={
        inSettings ? undefined : (
          <Menu className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
        )
      }
    />
  );
}
