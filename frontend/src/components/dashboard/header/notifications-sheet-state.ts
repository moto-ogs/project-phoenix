"use client";

// Offen-Zustand des Vollbild-Blatts der Benachrichtigungen (#7148). Klein und
// ohne Inhalt, damit Glocke und Menüzeile ihn überall laden können; das Blatt
// und der Inhalt kommen erst beim Öffnen (`notifications-panel`).

import { useCallback, useSyncExternalStore } from "react";

import { useNotificationFeedPortal } from "~/lib/notification-feed-portal";
import { onSessionTreeDiscard } from "~/lib/session-tree";
import { useTenantSafe } from "~/lib/tenant-context";

/** Abzeichen an Glocke und „Mehr“: zwei Ziffern sind das Höchste, „9+“. */
export const NOTIFICATIONS_BADGE_MAX = 9;

let sheetOpen = false;
const listeners = new Set<() => void>();

function setSheetOpen(next: boolean) {
  if (sheetOpen === next) return;
  sheetOpen = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// The sheet shows a person's notifications: it closes with their tree (#8082).
onSessionTreeDiscard(() => setSheetOpen(false));

const readOpen = () => sheetOpen;
const readServer = () => false;

/**
 * Zählt das Öffnen der Glocke (`notification_bell_opened`, ohne Inhalte).
 * Die Nutzungsanalyse lädt erst hier: Die Glocke steckt in der Kopfzeile
 * jedes Portals, die Analyse-Bibliothek gehört nicht in jedes Bündel.
 */
export function trackBellOpened(schoolId: string) {
  void import("~/lib/analytics").then(({ trackTenantEvent }) =>
    trackTenantEvent("notification_bell_opened", schoolId),
  );
}

/** Ob das Vollbild-Blatt offen ist, für `aria-expanded` an den Auslösern. */
export function useNotificationsSheetOpen(): boolean {
  return useSyncExternalStore(subscribe, readOpen, readServer);
}

/**
 * Die Schule der Sitzung für die Nutzungsanalyse; null ohne Schule. moto
 * schule nennt sie über den Portal-Kontext der Glocke (#7139).
 */
export function useAnalyticsSchoolId(): string | null {
  const portalSchoolId = useNotificationFeedPortal().analyticsSchoolId;
  const tenantSchoolId = useTenantSafe()?.tenant?.tenantId?.toString() ?? null;
  return portalSchoolId === undefined ? tenantSchoolId : portalSchoolId;
}

/**
 * Öffnet das Blatt und zählt das Öffnen der Glocke, von welchem Auslöser
 * auch immer (`notification_bell_opened`, ohne Inhalte).
 */
export function useOpenNotificationsSheet(): () => void {
  const schoolId = useAnalyticsSchoolId();
  return useCallback(() => {
    if (!sheetOpen && schoolId) {
      trackBellOpened(schoolId);
    }
    setSheetOpen(true);
  }, [schoolId]);
}

/** Öffnet das Blatt ohne Nutzungsanalyse der Schule (Elternportal, #7140). */
export function openNotificationsSheet() {
  setSheetOpen(true);
}

/** Ob das Blatt offen ist, außerhalb von React (Tests, Auslöser). */
export function isNotificationsSheetOpen(): boolean {
  return sheetOpen;
}

export function closeNotificationsSheet() {
  setSheetOpen(false);
}
