// Header bell for staff reminders (issue #1457) and the notification feed
// (#7148). Two sections: Erinnerungen on top (only while the school has a
// reminder type switched on), the feed („Hinweise") below. The badge counts
// unread Hinweise plus active Erinnerungen and shows „9+" from 10. Opening
// the bell marks nothing as read; a Hinweis is read by its click or „Alle als
// gelesen markieren". Below `sm` the bell opens the shared full-screen sheet
// (`NotificationsSheet`, rendered once by the bottom nav) instead of a popover.
// moto schule (#7139) mounts `NotificationFeedBell`: the same bell with the
// feed only, under the portal context of its school routes.

"use client";

import { Bell } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useState } from "react";

import { AnchoredPopover } from "~/components/ui/anchored-popover";
import { Button } from "~/components/ui/button";
import { NotificationBadge } from "~/components/ui/notification-badge";
import { BELOW_SM, useMediaQuery } from "~/lib/hooks/use-media-query";
import { useNotificationFeedUnread } from "~/lib/hooks/use-notification-feed";
import { useReminders } from "~/lib/hooks/use-reminders";

import {
  NOTIFICATIONS_BADGE_MAX,
  trackBellOpened,
  useAnalyticsSchoolId,
  useNotificationsSheetOpen,
  useOpenNotificationsSheet,
} from "./notifications-sheet-state";

// The bell is mounted on every staff page and the shared header of every
// portal; its content loads only when the popover opens.
const NotificationsPanelContent = dynamic(
  () =>
    import("./notifications-panel").then(
      (module) => module.NotificationsPanelContent,
    ),
  { ssr: false },
);

const NotificationFeedPanelContent = dynamic(
  () =>
    import("./notifications-panel").then(
      (module) => module.NotificationFeedPanelContent,
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
      feedOnly={false}
    />
  );
}

/**
 * Die Glocke von moto schule (#7139): nur die Hinweise, denn Erinnerungen der
 * Aufsicht gibt es dort nicht. Der Feed kommt über den Portal-Kontext aus der
 * Route des Schulportals.
 */
export function NotificationFeedBell() {
  const { unreadCount } = useNotificationFeedUnread();
  return (
    <NotificationsBell
      badgeCount={unreadCount}
      tooltip="Zeigt Ihre Hinweise, ohne die Seite zu verlassen."
      feedOnly
    />
  );
}

function NotificationsBell({
  badgeCount,
  tooltip,
  feedOnly,
}: Readonly<{ badgeCount: number; tooltip: string; feedOnly: boolean }>) {
  const isPhone = useMediaQuery(BELOW_SM);
  const schoolId = useAnalyticsSchoolId();
  const [isOpen, setIsOpen] = useState(false);
  const sheetOpen = useNotificationsSheetOpen();
  const openSheet = useOpenNotificationsSheet();

  const changeOpen = useCallback(
    (next: boolean) => {
      if (next && !isOpen && schoolId) {
        trackBellOpened(schoolId);
      }
      setIsOpen(next);
    },
    [isOpen, schoolId],
  );
  const close = useCallback(() => setIsOpen(false), []);

  const renderTrigger = ({
    ref,
    toggle,
    panelId,
    expanded,
  }: {
    ref?: React.Ref<HTMLButtonElement>;
    toggle: () => void;
    panelId?: string;
    expanded: boolean;
  }) => (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={
        badgeCount > 0
          ? `Benachrichtigungen (${badgeCount})`
          : "Benachrichtigungen"
      }
      aria-expanded={expanded}
      aria-haspopup="dialog"
      aria-controls={expanded ? panelId : undefined}
      tooltip={tooltip}
      className="relative"
    >
      <Bell className="h-5 w-5" />
      <NotificationBadge
        count={badgeCount}
        tone="red"
        size="sm"
        max={NOTIFICATIONS_BADGE_MAX}
        ariaLabel={`${badgeCount} Benachrichtigungen`}
        className="absolute -top-0.5 -right-0.5"
      />
    </Button>
  );

  if (isPhone) {
    return renderTrigger({ toggle: openSheet, expanded: sheetOpen });
  }

  return (
    <AnchoredPopover
      open={isOpen}
      onOpenChange={changeOpen}
      ariaLabel="Benachrichtigungen"
      preferredWidth={360}
      align="end"
      focusPanelOnOpen
      header={<p className="font-semibold text-gray-900">Benachrichtigungen</p>}
      renderTrigger={({ ref, toggle, panelId }) =>
        renderTrigger({ ref, toggle, panelId, expanded: isOpen })
      }
    >
      {() =>
        feedOnly ? (
          <NotificationFeedPanelContent onNavigate={close} />
        ) : (
          <NotificationsPanelContent onNavigate={close} />
        )
      }
    </AnchoredPopover>
  );
}
