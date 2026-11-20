"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";
import { Header } from "~/components/dashboard/header";
import { NotificationFeedBell } from "~/components/dashboard/header/reminders-bell";
import { DemoBanner, useDemoBannerShown } from "~/components/demo/demo-banner";
import { Z_LAYER } from "~/components/ui/overlay-styles";
import { PortalShell } from "~/components/ui/portal-shell";
import { TraegerBottomNav } from "./shell/traeger-bottom-nav";
import { TraegerNotificationFeedProvider } from "./shell/traeger-notification-feed";
import { TraegerReturnPathMemory } from "./shell/traeger-return-path";
import { TraegerSearchProvider } from "./shell/traeger-search";
import { TraegerSidebar } from "./shell/traeger-sidebar";
import { TraegerTestSystemNotice } from "./traeger-test-system-notice";

// Das Vollbild-Blatt der Glocke auf dem Telefon (#7146) lädt erst beim
// Öffnen seinen Inhalt; das Blatt selbst nur mit dieser Hülle.
const NotificationsSheet = dynamic(
  () =>
    import("~/components/dashboard/header/notifications-panel").then(
      (module) => module.NotificationsSheet,
    ),
  { ssr: false },
);

/**
 * Die Hülle des Träger-Portals ("moto träger", #4649).
 *
 * Gebaut wie die Hülle des Schul-Portals (#5145): den Rahmen liefert die
 * geteilte `PortalShell`, die Kopfzeile mit Seitentitel, Hilfe und
 * Profil-Menü („Abmelden") der geteilte `Header` mit der Glocke der Hinweise
 * aller Schulen des Trägers (#7146), die Seiten stehen in der
 * Seitenleiste und auf dem Telefon in der unteren Leiste. Welche Seiten eine
 * Person sieht, entscheiden ihre Rechte (`traeger-nav-items.ts`).
 *
 * Die Kopfzeile bleibt auf jeder Breite sichtbar; sie trägt den einzigen
 * Weg aus dem Portal heraus.
 *
 * Die Inhaltshülle ist eine Flex-Spalte wie im Personal- und Schul-Portal:
 * erst dann wächst die letzte Fläche einer `TenantPage` bis zur Unterkante,
 * auch auf einer kurzen oder leeren Seite (#6872).
 */
export function TraegerShell({
  children,
  testSystem = false,
  federalStates,
}: {
  readonly children: React.ReactNode;
  /** Ein Test-Träger (#4658) bekommt über der Kopfzeile einen Hinweis. */
  readonly testSystem?: boolean;
  /** Die Bundesländer der Schulen; die Tagesmeldung gibt es nur für M-V (#4717). */
  readonly federalStates?: readonly string[];
}) {
  // Öffentliche Demo (#6193): derselbe feste Streifen wie in der OGS-App
  // (h-12). Kopfzeile und Seitenleiste rücken um seine Höhe nach unten.
  const demoBannerShown = useDemoBannerShown();
  return (
    <TraegerNotificationFeedProvider>
      {/* Die Suche nach Seiten und Schulen mit Strg+K (#7648). */}
      <TraegerSearchProvider federalStates={federalStates}>
        <div className={demoBannerShown ? "pt-12" : undefined}>
          <PortalShell
            header={<Header notificationBell={<NotificationFeedBell />} />}
            headerClassName={`sticky ${demoBannerShown ? "top-12" : "top-0"} ${Z_LAYER.header}`}
            topLayer={
              <>
                {demoBannerShown ? <DemoBanner /> : null}
                {testSystem ? <TraegerTestSystemNotice /> : null}
              </>
            }
            sidebar={<TraegerSidebar federalStates={federalStates} />}
            bottomNav={<TraegerBottomNav federalStates={federalStates} />}
            // Eine Flex-Spalte bis zur Inhaltshülle, wie im Personal- und
            // Schul-Portal: die letzte Fläche einer Seite reicht dann bis zur
            // Unterkante (TENANT-PAGE-SPEC, Regel 6).
            contentClassName="flex flex-1 flex-col"
          >
            <Suspense fallback={null}>
              <TraegerReturnPathMemory />
            </Suspense>
            {children}
          </PortalShell>
        </div>
      </TraegerSearchProvider>
      <NotificationsSheet feedOnly />
    </TraegerNotificationFeedProvider>
  );
}
