"use client";

// Inhalt der Glocke im Elternportal (#7140): die Hinweise des Kontos über alle
// Schulen der Familie. Derselbe Inhalt im Fenster am Desktop und im
// Vollbild-Blatt auf dem Telefon.

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";

import {
  type NotificationFeedCopy,
  NotificationFeedList,
} from "~/components/dashboard/header/notification-feed-list";
import {
  PARENT_NOTIFICATION_FEED,
  useNotificationFeedUnread,
} from "~/lib/hooks/use-notification-feed";
import { parentPath } from "~/lib/parent-url";

import {
  trackParentFeedAllRead,
  trackParentFeedEntryClicked,
} from "./parent-notifications-analytics";

export function ParentNotificationsContent({
  onNavigate,
}: Readonly<{ onNavigate: () => void }>) {
  const t = useTranslations("parentNotificationFeed");
  const locale = useLocale();
  const router = useRouter();
  const { unreadCount, setUnreadCount } = useNotificationFeedUnread(
    true,
    PARENT_NOTIFICATION_FEED,
  );
  const copy = useMemo(
    (): NotificationFeedCopy => ({
      section: t("section"),
      markAllRead: t("markAllRead"),
      markAllReadTooltip: t("markAllReadTooltip"),
      markAllReadErrorObject: t("markAllReadErrorObject"),
      loadErrorObject: t("loadErrorObject"),
      loading: t("loading"),
      emptyTitle: t("emptyTitle"),
      emptyDescription: t("emptyDescription"),
      unread: t("unread"),
      loadMore: t("loadMore"),
      loadingMore: t("loadingMore"),
      loadMoreTooltip: t("loadMoreTooltip"),
    }),
    [t],
  );
  const navigate = useCallback(
    (link: string) => {
      onNavigate();
      router.push(parentPath(link));
    },
    [onNavigate, router],
  );
  return (
    <NotificationFeedList
      source={PARENT_NOTIFICATION_FEED}
      copy={copy}
      locale={locale}
      unreadCount={unreadCount}
      onUnreadCount={setUnreadCount}
      navigate={navigate}
      onEntryClicked={trackParentFeedEntryClicked}
      onAllRead={trackParentFeedAllRead}
    />
  );
}
