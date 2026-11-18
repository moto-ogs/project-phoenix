"use client";

// Portale ohne Live-Kanal (Träger- und Caterer-Portal, #7146, #7147): Zähler
// und offene Liste der Glocke laden nach jedem Seitenwechsel neu. Der erste
// Abruf beim Laden der Seite kommt aus SWR selbst, danach jede Minute
// (useNotificationFeedUnread).

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { NOTIFICATION_FEED_REFRESH_EVENT } from "~/lib/notification-events";

export function NotificationFeedPageReload() {
  const pathname = usePathname();
  const previousPathname = useRef(pathname);

  useEffect(() => {
    if (pathname === previousPathname.current) return;
    previousPathname.current = pathname;
    window.dispatchEvent(new CustomEvent(NOTIFICATION_FEED_REFRESH_EVENT));
  }, [pathname]);

  return null;
}
