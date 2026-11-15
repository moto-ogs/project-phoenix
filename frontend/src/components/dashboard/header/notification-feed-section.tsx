"use client";

// Abschnitt „Hinweise“ der Glocke (#7148): der Benachrichtigungs-Feed des
// Kontos in dieser Schule. Lädt erst, wenn die Glocke offen ist (die Glocke
// bindet diese Datei mit next/dynamic ein).

import { useCallback } from "react";

import { trackTenantEvent } from "~/lib/analytics";
import { STAFF_NOTIFICATION_FEED } from "~/lib/hooks/use-notification-feed";
import { NOTIFICATION_FEED_ANALYTICS_TYPES } from "~/lib/notification-feed-helpers";
import { useTenantRouter } from "~/lib/tenant-router";

import {
  type NotificationFeedCopy,
  NotificationFeedList,
} from "./notification-feed-list";

const ANALYTICS_TYPES: ReadonlySet<string> = new Set(
  NOTIFICATION_FEED_ANALYTICS_TYPES,
);

const STAFF_COPY: NotificationFeedCopy = {
  section: "Hinweise",
  markAllRead: "Alle als gelesen markieren",
  markAllReadTooltip: "Markiert sofort alle Hinweise als gelesen.",
  markAllReadErrorObject: "das Markieren als gelesen",
  loadErrorObject: "die Hinweise",
  loading: "Hinweise werden geladen.",
  emptyTitle: "Keine Hinweise.",
  emptyDescription:
    "Hier steht zum Beispiel, wenn einer Ihrer Termine ausfällt.",
  unread: "Neu",
  loadMore: "Weitere laden",
  loadingMore: "Weitere Hinweise werden geladen.",
  loadMoreTooltip: "Zeigt ältere Hinweise.",
};

export function NotificationFeedSection({
  schoolId,
  unreadCount,
  onUnreadCount,
  onNavigate,
}: Readonly<{
  /** Für die Nutzungsanalyse; ohne Schule wird nichts erfasst. */
  schoolId: string | null;
  unreadCount: number;
  onUnreadCount: (count: number) => void;
  /** Schließt die Glocke, bevor die Zielseite lädt. */
  onNavigate: () => void;
}>) {
  const router = useTenantRouter();
  const navigate = useCallback(
    (link: string) => {
      onNavigate();
      router.push(link);
    },
    [onNavigate, router],
  );
  const entryClicked = useCallback(
    (type: string) => {
      if (!schoolId) return;
      trackTenantEvent(
        "notification_feed_entry_clicked",
        schoolId,
        ANALYTICS_TYPES.has(type) ? { notification_type: type } : undefined,
      );
    },
    [schoolId],
  );
  const allRead = useCallback(() => {
    if (schoolId) trackTenantEvent("notification_feed_all_read", schoolId);
  }, [schoolId]);
  return (
    <NotificationFeedList
      source={STAFF_NOTIFICATION_FEED}
      copy={STAFF_COPY}
      unreadCount={unreadCount}
      onUnreadCount={onUnreadCount}
      navigate={navigate}
      onEntryClicked={entryClicked}
      onAllRead={allRead}
    />
  );
}
