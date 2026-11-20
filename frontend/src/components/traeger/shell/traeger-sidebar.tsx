"use client";

import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  PortalSidebar,
  PortalSidebarGroup,
  PortalSidebarLink,
  PortalSettingsSidebarEntries,
} from "~/components/ui/portal-sidebar";
import { portalSidebarTopOffset } from "~/components/ui/sidebar-geometry";
import { useDemoBannerShown } from "~/components/demo/demo-banner";
import { useStoredOpenGroups } from "~/lib/hooks/use-stored-open-groups";
import { traegerPath } from "~/lib/traeger-url";
import {
  isTraegerNavActive,
  isTraegerSettingsPath,
} from "./traeger-nav-active";
import {
  TRAEGER_BACK_NAV,
  TRAEGER_HELP_NAV,
  TRAEGER_NAV_GROUP_KEYS,
  TRAEGER_SETTINGS_NAV,
  traegerNavGroupKeyFor,
  traegerNavGroupsFor,
  traegerSettingsNavItemsFor,
} from "./traeger-nav-items";
import { useTraegerReturnHref } from "./traeger-return-path";

/** Eigener Schlüssel fürs Träger-Portal; die OGS-App nutzt `sidebar-open-groups`. */
const openGroupsStorageKey = "traeger-sidebar-open-groups";
const KNOWN_GROUP_KEYS: ReadonlySet<string> = new Set(TRAEGER_NAV_GROUP_KEYS);

/**
 * Die dauerhafte Seitennavigation des Träger-Portals ab 1024 px (#5145):
 * die geteilte `PortalSidebar` mit den Zielen, die die Rechte der Person
 * öffnen. Dieselbe Leiste zeigt je nach Adresse die Hauptnavigation oder die
 * Einstellungen mit dem Rückweg zur App (#5685). Abmelden sitzt im Profil-Menü
 * der geteilten Kopfzeile, die auf jeder Breite sichtbar ist.
 */
export function TraegerSidebar({
  federalStates,
}: {
  /** Die Bundesländer der Schulen des Trägers, für Einträge wie die Tagesmeldung (#4717). */
  readonly federalStates?: readonly string[];
}) {
  const pathname = usePathname() ?? "";
  const { data: session } = useSession();
  const settingsItems = traegerSettingsNavItemsFor(session ?? null);
  const returnHref = useTraegerReturnHref();
  // The demo banner (#6193) sits above the header; the sidebar moves with it.
  const topOffset = portalSidebarTopOffset(useDemoBannerShown());
  const groups = traegerNavGroupsFor(session ?? null, federalStates);
  // Einklappbare Gruppen wie in der OGS-App (#7647): anfangs alle offen, der
  // Zustand bleibt im Browser, die Gruppe der aktuellen Seite ist immer offen.
  const { isGroupOpen, toggleGroup } = useStoredOpenGroups({
    storageKey: openGroupsStorageKey,
    knownKeys: KNOWN_GROUP_KEYS,
    currentGroup: traegerNavGroupKeyFor(groups, pathname),
    defaultGroups: TRAEGER_NAV_GROUP_KEYS,
  });

  if (isTraegerSettingsPath(pathname)) {
    return (
      <PortalSidebar
        navLabel={TRAEGER_SETTINGS_NAV.label}
        topOffset={topOffset}
      >
        <PortalSettingsSidebarEntries
          back={{ ...TRAEGER_BACK_NAV, href: returnHref }}
          groupLabel={TRAEGER_SETTINGS_NAV.label}
          items={settingsItems.map((item) => ({
            key: item.key,
            href: traegerPath(item.href),
            label: item.label,
            concept: item.concept,
            active: isTraegerNavActive(item.href, pathname),
          }))}
          navItemAttribute="data-traeger-nav-item"
        />
      </PortalSidebar>
    );
  }

  const settingsEntry = settingsItems[0];
  return (
    <PortalSidebar
      topOffset={topOffset}
      secondaryLabel="Hilfe und Einstellungen"
      secondary={
        <>
          <PortalSidebarLink
            href={TRAEGER_HELP_NAV.href}
            label={TRAEGER_HELP_NAV.label}
            concept={TRAEGER_HELP_NAV.concept}
            active={false}
            newTab
            data-traeger-nav-item={TRAEGER_HELP_NAV.key}
          />
          {settingsEntry ? (
            <PortalSidebarLink
              href={traegerPath(settingsEntry.href)}
              label={TRAEGER_SETTINGS_NAV.label}
              concept={TRAEGER_SETTINGS_NAV.concept}
              active={false}
              data-traeger-nav-item={TRAEGER_SETTINGS_NAV.key}
            />
          ) : null}
        </>
      }
    >
      {groups.map((group) => (
        <PortalSidebarGroup
          key={group.key}
          label={group.label}
          isOpen={isGroupOpen(group.key)}
          onToggle={() => toggleGroup(group.key)}
        >
          {group.items.map((item) => (
            <PortalSidebarLink
              key={item.key}
              href={traegerPath(item.href)}
              label={item.label}
              concept={item.concept}
              active={isTraegerNavActive(item.href, pathname)}
              data-traeger-nav-item={item.key}
            />
          ))}
        </PortalSidebarGroup>
      ))}
    </PortalSidebar>
  );
}
