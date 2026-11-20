"use client";

import {
  getStaffNavGroupForPathname,
  STAFF_NAV_GROUPS,
  type StaffNavGroupKey,
} from "~/lib/staff-navigation";
import { useStoredOpenGroups } from "./use-stored-open-groups";

const openGroupsStorageKey = "sidebar-open-groups";

const KNOWN_GROUP_KEYS: ReadonlySet<string> = new Set<string>(
  STAFF_NAV_GROUPS.map((group) => group.key),
);

/**
 * Welche Gruppen der Seitenleiste der OGS-App offen stehen (#2826).
 *
 * Beim ersten Besuch stehen `defaultGroups` offen
 * (`getStaffNavDefaultOpenGroups`, je nach Rolle). Was die Person auf- oder
 * zuklappt, merkt sich der Browser (`sidebar-open-groups`); die Gruppe der
 * aktuellen Seite öffnet sich von selbst. Seitenleiste und Mehr-Menü (#7048)
 * teilen einen Stand. Das Verhalten im Einzelnen: `useStoredOpenGroups`.
 */
export function useSidebarGroups(
  pathname: string,
  fromParam: string | null | undefined,
  defaultGroups: readonly StaffNavGroupKey[],
) {
  return useStoredOpenGroups<StaffNavGroupKey>({
    storageKey: openGroupsStorageKey,
    knownKeys: KNOWN_GROUP_KEYS,
    currentGroup: getStaffNavGroupForPathname(pathname, fromParam),
    defaultGroups,
  });
}
