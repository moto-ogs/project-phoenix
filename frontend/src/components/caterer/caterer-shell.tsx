"use client";

import { Header } from "~/components/dashboard/header";
import { NotificationFeedBell } from "~/components/dashboard/header/notification-feed-bell";
import { PortalShell } from "~/components/ui/portal-shell";
import { CatererNotificationFeedProvider } from "./caterer-notification-feed";
import { CatererNotificationsSheet } from "./caterer-notifications-sheet";

/**
 * Die Hülle des Caterer-Portals (ADR 0077).
 *
 * Den Rahmen liefert die geteilte `PortalShell`, die Kopfzeile mit Profil-Menü
 * und „Abmelden“ der geteilte `Header` mit der Glocke der Hinweise aller
 * belieferten Schulen (#7147). Das Portal hat nur die eine Seite
 * „Bestellungen“, deshalb gibt es keine Seitennavigation und keine mobile
 * Leiste.
 */
export function CatererShell({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    <CatererNotificationFeedProvider>
      <PortalShell
        header={<Header notificationBell={<NotificationFeedBell />} />}
        sidebar={null}
        bottomNav={null}
      >
        {children}
      </PortalShell>
      <CatererNotificationsSheet />
    </CatererNotificationFeedProvider>
  );
}
