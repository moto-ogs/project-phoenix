"use client";

// Die Glocke des Träger-Portals (#7146): die Hinweise aller Schulen des
// Trägers, jeweils mit dem Namen der Schule. Das Träger-Portal hat keinen
// Live-Kanal und keine Mitteilungen aufs Handy: Der Zähler lädt bei jedem
// Seitenwechsel neu und ohne Live-Kanal jede Minute (useNotificationFeedUnread).
// Die Nutzungsanalyse erfasst im Träger-Portal nichts (analytics-policy.ts),
// darum nennt die Glocke keine Schule dafür.

import type { ReactNode } from "react";

import { NotificationFeedPageReload } from "~/components/dashboard/header/notification-feed-page-reload";
import {
  type NotificationFeedPortal,
  NotificationFeedPortalProvider,
} from "~/lib/notification-feed-portal";
import { traegerPath } from "~/lib/traeger-url";

const TRAEGER_NOTIFICATION_FEED_PORTAL: NotificationFeedPortal = {
  apiBase: "/api/traeger/notifications/feed",
  keyScope: "traeger",
  resolveLink: traegerPath,
  analyticsSchoolId: null,
};

export function TraegerNotificationFeedProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <NotificationFeedPortalProvider value={TRAEGER_NOTIFICATION_FEED_PORTAL}>
      <NotificationFeedPageReload />
      {children}
    </NotificationFeedPortalProvider>
  );
}
