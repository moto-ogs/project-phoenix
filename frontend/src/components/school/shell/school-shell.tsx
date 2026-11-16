"use client";

import dynamic from "next/dynamic";

import { Header } from "~/components/dashboard/header";
import { NotificationFeedBell } from "~/components/dashboard/header/reminders-bell";
import { PortalShell } from "~/components/ui/portal-shell";
import { useSchoolStaffNoticesPending } from "~/lib/hooks/use-school-staff-notices-pending";
import { useSchoolTeamChatUnread } from "~/lib/hooks/use-school-team-chat-unread";
import { SchoolBottomNav } from "./school-bottom-nav";
import { SchoolNotificationFeedProvider } from "./school-notification-feed";
import { SchoolSettingsReturnPathMemory } from "./school-settings-nav";
import { SchoolSidebar } from "./school-sidebar";

// Das Vollbild-Blatt der Glocke auf dem Telefon (#7139) lädt erst beim
// Öffnen seinen Inhalt; das Blatt selbst nur mit dieser Hülle.
const NotificationsSheet = dynamic(
  () =>
    import("~/components/dashboard/header/notifications-panel").then(
      (module) => module.NotificationsSheet,
    ),
  { ssr: false },
);

/**
 * Die Hülle des Schul-Portals ("moto schule", #2207).
 *
 * Der Rahmen kommt aus der geteilten `PortalShell`; hier steht nur, was das
 * Schul-Portal von den anderen unterscheidet: seine eigene Navigation. Die
 * Navigation eines Portals gehört zu diesem Portal, nicht als Sonderzweig in
 * die Mitarbeiter-Navigation — die Eltern-App hat das mit `ParentShell`
 * vorgemacht.
 *
 * Die Kopfzeile bleibt geteilt und auf jeder Breite sichtbar — sie trägt
 * den Seitentitel, die Glocke mit den Hinweisen (#7139) und das Profil-Menü
 * mit "Abmelden", also den einzigen Weg aus dem Portal heraus. Auf dem
 * Telefon öffnet die Glocke das Vollbild-Blatt.
 */
export function SchoolShell({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const teamChat = useSchoolTeamChatUnread();
  const notices = useSchoolStaffNoticesPending();
  return (
    <SchoolNotificationFeedProvider>
      <PortalShell
        header={<Header notificationBell={<NotificationFeedBell />} />}
        sidebar={<SchoolSidebar teamChat={teamChat} notices={notices} />}
        bottomNav={<SchoolBottomNav teamChat={teamChat} notices={notices} />}
        contentClassName="flex flex-1 flex-col"
      >
        <SchoolSettingsReturnPathMemory />
        {children}
      </PortalShell>
      <NotificationsSheet feedOnly />
    </SchoolNotificationFeedProvider>
  );
}
