"use client";

// Die Glocke der Kopfzeile ohne Erinnerungen (#7139, #7146, #7147): der
// Knopf mit Zähler, am Desktop der Rahmen, auf dem Telefon öffnet sie das
// Blatt der Hülle (`useOpenNotificationsSheet`). `RemindersBell` setzt
// dieselbe Glocke mit den Erinnerungen zusammen. Dieses Modul lädt weder den
// Erinnerungs-Code noch das Blatt, damit Portale mit eigener Hülle (Caterer)
// nur das laden, was ihre Glocke braucht.

import { Bell } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useState } from "react";

import { AnchoredPopover } from "~/components/ui/anchored-popover";
import { Button } from "~/components/ui/button";
import { NotificationBadge } from "~/components/ui/notification-badge";
import { BELOW_SM, useMediaQuery } from "~/lib/hooks/use-media-query";
import { useNotificationFeedUnread } from "~/lib/hooks/use-notification-feed";

import {
  NOTIFICATIONS_BADGE_MAX,
  trackBellOpened,
  useAnalyticsSchoolId,
  useNotificationsSheetOpen,
  useOpenNotificationsSheet,
} from "./notifications-sheet-state";

// Der Inhalt lädt erst, wenn sich der Rahmen öffnet.
const NotificationFeedPanelContent = dynamic(
  () =>
    import("./notification-feed-panel-content").then(
      (module) => module.NotificationFeedPanelContent,
    ),
  { ssr: false },
);

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
      renderPanel={(close) => (
        <NotificationFeedPanelContent onNavigate={close} />
      )}
    />
  );
}

export function NotificationsBell({
  badgeCount,
  tooltip,
  renderPanel,
}: Readonly<{
  badgeCount: number;
  tooltip: string;
  /** Inhalt des Rahmens am Desktop; `close` schließt ihn nach einem Klick. */
  renderPanel: (close: () => void) => React.ReactNode;
}>) {
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
  const badgeLabel =
    badgeCount > NOTIFICATIONS_BADGE_MAX
      ? `${NOTIFICATIONS_BADGE_MAX}+ Benachrichtigungen, insgesamt ${badgeCount}`
      : `${badgeCount} ${badgeCount === 1 ? "Benachrichtigung" : "Benachrichtigungen"}`;

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
      aria-label={badgeCount > 0 ? badgeLabel : "Benachrichtigungen"}
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
        ariaLabel={badgeLabel}
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
      {() => renderPanel(close)}
    </AnchoredPopover>
  );
}
