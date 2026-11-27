"use client";

import { STAFF_NAV_GROUPS } from "~/lib/staff-navigation";
import { useStoredOpenGroups } from "./use-stored-open-groups";

/**
 * Die Abschnitte der Seite „Mehr“ (#8070): eigene oben und unten, dazwischen
 * die Gruppen der Seitenleiste. Unbekanntes im Speicher fällt weg.
 */
const MORE_SECTION_KEYS: ReadonlySet<string> = new Set<string>([
  "neu",
  "tag",
  "konto",
  "top",
  "simple",
  "operator",
  "bottom",
  ...STAFF_NAV_GROUPS.map((group) => group.key),
]);

const NO_GROUPS: readonly string[] = [];

/**
 * Welche Abschnitte der Seite „Mehr“ zugeklappt sind (Feedback 27.11.).
 *
 * Dieselbe Mechanik wie die Gruppen der Seitenleiste (`useStoredOpenGroups`),
 * nur andersherum gespeichert: Gemerkt wird, was zu ist. So steht beim ersten
 * Besuch alles offen, und ein Abschnitt, der später dazukommt („Neu für
 * dich“), erscheint offen. Der Schlüssel trägt Schule und Konto: Am geteilten
 * Gerät behält jede Person ihre eigene Ansicht, und er nennt nur Namen von
 * Abschnitten, keine Daten anderer Personen (darum bleibt er beim Abmelden,
 * siehe `KEPT_STORAGE_KEYS`).
 *
 * Erst mit bekanntem Konto aufrufen: Der gespeicherte Stand wird einmal nach
 * dem Einhängen gelesen.
 */
export function useMoreClosedGroups(tenantSlug: string, accountId: string) {
  const closedGroupsStorageKey = `mehr-closed-groups:${tenantSlug}:${accountId}`;
  const { isGroupOpen: isClosed, toggleGroup } = useStoredOpenGroups<string>({
    storageKey: closedGroupsStorageKey,
    knownKeys: MORE_SECTION_KEYS,
    currentGroup: null,
    defaultGroups: NO_GROUPS,
  });
  return {
    isSectionOpen: (key: string) => !isClosed(key),
    toggleSection: toggleGroup,
  };
}
