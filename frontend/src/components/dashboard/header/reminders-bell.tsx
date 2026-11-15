// Header bell for staff reminders (issue #1457) and the notification feed
// (#7148). Two sections: Erinnerungen on top (only while the school has a
// reminder type switched on), the feed („Hinweise") below. The badge counts
// unread Hinweise plus active Erinnerungen and shows „9+" from 10. Opening
// the bell marks nothing as read; a Hinweis is read by its click or „Alle als
// gelesen markieren". Below `sm` the bell opens the shared full-screen sheet
// (`NotificationsSheet`, rendered once by the bottom nav) instead of a popover.

"use client";

import { Bell } from "lucide-react";
import { useCallback, useState } from "react";

import { AnchoredPopover } from "~/components/ui/anchored-popover";
import { Button } from "~/components/ui/button";
import { NotificationBadge } from "~/components/ui/notification-badge";
import { trackTenantEvent } from "~/lib/analytics";
import { BELOW_SM, useMediaQuery } from "~/lib/hooks/use-media-query";
import { useNotificationFeedUnread } from "~/lib/hooks/use-notification-feed";
import { useReminders } from "~/lib/hooks/use-reminders";

import {
  NOTIFICATIONS_BADGE_MAX,
  NotificationsPanelContent,
  useAnalyticsSchoolId,
  useNotificationsSheetOpen,
  useOpenNotificationsSheet,
} from "./notifications-panel";

export function RemindersBell() {
  const { count, enabled } = useReminders();
  const { unreadCount } = useNotificationFeedUnread();
  const isPhone = useMediaQuery(BELOW_SM);
  const schoolId = useAnalyticsSchoolId();
  const [isOpen, setIsOpen] = useState(false);
  const sheetOpen = useNotificationsSheetOpen();
  const openSheet = useOpenNotificationsSheet();

  const badgeCount = unreadCount + (enabled ? count : 0);

  const changeOpen = useCallback(
    (next: boolean) => {
      if (next && !isOpen && schoolId) {
        trackTenantEvent("notification_bell_opened", schoolId);
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
      tooltip="Zeigt Erinnerungen und Hinweise, ohne die Seite zu verlassen."
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
      {() => <NotificationsPanelContent onNavigate={close} />}
    </AnchoredPopover>
  );
}
