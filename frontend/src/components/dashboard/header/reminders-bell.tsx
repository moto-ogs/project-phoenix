// Header bell for staff reminders (issue #1457) and the notification feed
// (#7148). Two sections: Erinnerungen on top (only while the school has a
// reminder type switched on), the feed („Hinweise") below. The badge counts
// unread Hinweise plus active Erinnerungen and shows „9+" from 10. Opening
// the bell marks nothing as read; a Hinweis is read by its click or „Alle als
// gelesen markieren". Below `sm` the bell opens the shared full-screen sheet
// (`NotificationsSheet`, rendered once by the bottom nav) instead of a popover.
// moto schule (#7139) mounts `NotificationFeedBell` (notification-feed-bell):
// the same bell with the feed only, under the portal context of its routes.

"use client";

import dynamic from "next/dynamic";

import { useNotificationFeedUnread } from "~/lib/hooks/use-notification-feed";
import { useReminders } from "~/lib/hooks/use-reminders";

import { NotificationsBell } from "./notification-feed-bell";

export { NotificationFeedBell } from "./notification-feed-bell";

// The bell is mounted on every staff page and the shared header of every
// portal; its content loads only when the popover opens.
const NotificationsPanelContent = dynamic(
  () =>
    import("./notifications-panel").then(
      (module) => module.NotificationsPanelContent,
    ),
  { ssr: false },
);

export function RemindersBell() {
  const { count, enabled } = useReminders();
  const { unreadCount } = useNotificationFeedUnread();
  return (
    <NotificationsBell
      badgeCount={unreadCount + (enabled ? count : 0)}
      tooltip="Zeigt Erinnerungen und Hinweise, ohne die Seite zu verlassen."
      renderPanel={(close) => <NotificationsPanelContent onNavigate={close} />}
    />
  );
}
