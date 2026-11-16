"use client";

// Die Glocke des Elternportals (#7140): Hinweise der Schule zu den Kindern
// des Kontos, über alle Schulen der Familie. Ab 1024 px steht sie in der
// Kopfzeile und öffnet ein Fenster; darunter fehlt die Kopfzeile, und der
// Eintrag „Hinweise“ im Menü „Mehr“ öffnet dasselbe Vollbild-Blatt
// (`ParentNotificationsSheet`). Das Öffnen liest nichts; gelesen wird ein
// Hinweis durch seinen Klick oder „Alle als gelesen markieren“.

import { Bell } from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";

import { AnchoredPopover } from "~/components/ui/anchored-popover";
import { Button } from "~/components/ui/button";
import { NotificationBadge } from "~/components/ui/notification-badge";
import { COUNTER_TONE } from "~/lib/counter-tones";
import {
  PARENT_NOTIFICATION_FEED,
  useNotificationFeedUnread,
} from "~/lib/hooks/use-notification-feed";

import { NOTIFICATIONS_BADGE_MAX } from "~/components/dashboard/header/notifications-sheet-state";
import { trackParentBellOpened } from "./parent-notifications-analytics";

// Die Liste lädt erst, wenn die Glocke offen ist.
const ParentNotificationsContent = dynamic(
  () =>
    import("./parent-notifications-content").then(
      (module) => module.ParentNotificationsContent,
    ),
  { ssr: false },
);

/** Zähler der Glocke; die Hülle lädt ihn einmal für Kopfzeile und „Mehr“. */
export function useParentNotificationsUnread(enabled: boolean) {
  return useNotificationFeedUnread(enabled, PARENT_NOTIFICATION_FEED);
}

export function ParentNotificationsBell() {
  const t = useTranslations("parentNotificationFeed");
  const { unreadCount } = useParentNotificationsUnread(true);
  const [isOpen, setIsOpen] = useState(false);

  const changeOpen = useCallback(
    (next: boolean) => {
      if (next && !isOpen) trackParentBellOpened();
      setIsOpen(next);
    },
    [isOpen],
  );
  const close = useCallback(() => setIsOpen(false), []);

  return (
    <AnchoredPopover
      open={isOpen}
      onOpenChange={changeOpen}
      ariaLabel={t("bell")}
      preferredWidth={360}
      align="end"
      focusPanelOnOpen
      header={<p className="font-semibold text-gray-900">{t("bell")}</p>}
      renderTrigger={({ ref, toggle, panelId }) => (
        <Button
          ref={ref}
          type="button"
          variant="ghost"
          size="icon"
          onClick={toggle}
          aria-label={
            unreadCount > 0 ? t("bellCount", { count: unreadCount }) : t("bell")
          }
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          aria-controls={isOpen ? panelId : undefined}
          tooltip={t("bellTooltip")}
          className="relative"
        >
          <Bell className="h-5 w-5" />
          <NotificationBadge
            count={unreadCount}
            tone={COUNTER_TONE.parents}
            size="sm"
            max={NOTIFICATIONS_BADGE_MAX}
            ariaLabel={t("badge", { count: unreadCount })}
            className="absolute -top-0.5 -right-0.5"
          />
        </Button>
      )}
    >
      {() => <ParentNotificationsContent onNavigate={close} />}
    </AnchoredPopover>
  );
}
