"use client";

// Der Inhalt der Glocke nur mit den Hinweisen (#7139): ohne Erinnerungen und
// ohne das Vollbild-Blatt, damit Portale mit eigener Hülle (Caterer, #7147)
// weder den Erinnerungs-Code noch den Drawer mitladen.

import dynamic from "next/dynamic";

import { Loading } from "~/components/ui/loading";
import { useNotificationFeedUnread } from "~/lib/hooks/use-notification-feed";

import { useAnalyticsSchoolId } from "./notifications-sheet-state";

// The feed list, its hooks and the infinite scroll load only when the panel
// opens: the bell itself is mounted on every staff page.
export const NotificationFeedSection = dynamic(
  () =>
    import("./notification-feed-section").then(
      (module) => module.NotificationFeedSection,
    ),
  {
    ssr: false,
    loading: () => <Loading compact message="Hinweise werden geladen." />,
  },
);

/**
 * Nur die Hinweise, ohne Erinnerungen: moto schule (#7139) hat keine
 * Erinnerungen der Aufsicht.
 */
export function NotificationFeedPanelContent({
  onNavigate,
}: Readonly<{ onNavigate: () => void }>) {
  const { unreadCount, setUnreadCount } = useNotificationFeedUnread();
  const schoolId = useAnalyticsSchoolId();
  return (
    <NotificationFeedSection
      schoolId={schoolId}
      unreadCount={unreadCount}
      onUnreadCount={setUnreadCount}
      onNavigate={onNavigate}
    />
  );
}
