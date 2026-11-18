"use client";

// Die Glocke des Caterer-Portals (#7147): Speiseplanänderungen und
// Schließtage aller Schulen, die der Caterer beliefert, jeweils mit dem Namen
// der Schule. Das Caterer-Portal hat keinen Live-Kanal und keine Mitteilungen
// aufs Handy: Der Zähler lädt bei jedem Seitenwechsel neu und ohne Live-Kanal
// jede Minute (useNotificationFeedUnread). Die Ereignisse der Glocke zählen
// für eine Schule; eine Caterer-Sitzung hat keine, darum erfasst die Glocke
// hier nichts.

import type { ReactNode } from "react";

import { NotificationFeedPageReload } from "~/components/dashboard/header/notification-feed-page-reload";
import { catererPath } from "~/lib/caterer-url";
import {
  type NotificationFeedPortal,
  NotificationFeedPortalProvider,
} from "~/lib/notification-feed-portal";

const CATERER_NOTIFICATION_FEED_PORTAL: NotificationFeedPortal = {
  apiBase: "/api/caterer/notifications/feed",
  keyScope: "caterer",
  resolveLink: catererPath,
  analyticsSchoolId: null,
};

export function CatererNotificationFeedProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <NotificationFeedPortalProvider value={CATERER_NOTIFICATION_FEED_PORTAL}>
      <NotificationFeedPageReload />
      {children}
    </NotificationFeedPortalProvider>
  );
}
