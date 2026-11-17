"use client";

// Die Glocke des Träger-Portals (#7146): die Hinweise aller Schulen des
// Trägers, jeweils mit dem Namen der Schule. Das Träger-Portal hat keinen
// Live-Kanal und keine Mitteilungen aufs Handy: Der Zähler lädt bei jedem
// Seitenwechsel neu und ohne Live-Kanal jede Minute (useNotificationFeedUnread).
// Die Nutzungsanalyse erfasst im Träger-Portal nichts (analytics-policy.ts),
// darum nennt die Glocke keine Schule dafür.

import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { NOTIFICATION_FEED_REFRESH_EVENT } from "~/lib/notification-events";
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
      <ReloadOnPageChange />
      {children}
    </NotificationFeedPortalProvider>
  );
}

/**
 * Lädt Zähler und offene Liste nach jedem Seitenwechsel neu. Der erste
 * Abruf beim Laden der Seite kommt aus SWR selbst.
 */
function ReloadOnPageChange() {
  const pathname = usePathname();
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(NOTIFICATION_FEED_REFRESH_EVENT));
  }, [pathname]);
  return null;
}
