"use client";

// Abschnitt „Hinweise“ der Glocke (#7148): der Benachrichtigungs-Feed des
// Kontos in dieser Schule. Lädt erst, wenn die Glocke offen ist (die Glocke
// bindet diese Datei mit next/dynamic ein).

import { useCallback, useRef } from "react";

import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { ListGroupHeader } from "~/components/ui/list-group-header";
import { ListRowLink } from "~/components/ui/list-row-link";
import { Loading } from "~/components/ui/loading";
import { useApiErrorDisplay } from "~/contexts/ToastContext";
import { trackTenantEvent } from "~/lib/analytics";
import { formatChatTime } from "~/lib/date-helpers";
import {
  type NotificationFeedItem,
  useNotificationFeed,
} from "~/lib/hooks/use-notification-feed";
import { useOnVisible } from "~/lib/hooks/use-on-visible";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { isSafeAppRelativePath } from "~/lib/notification-deep-link";
import { NOTIFICATION_FEED_ANALYTICS_TYPES } from "~/lib/notification-feed-helpers";
import { useNotificationFeedPortal } from "~/lib/notification-feed-portal";
import { useTenantRouter } from "~/lib/tenant-router";

const ANALYTICS_TYPES: ReadonlySet<string> = new Set(
  NOTIFICATION_FEED_ANALYTICS_TYPES,
);

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
  const { resolveLink } = useNotificationFeedPortal();
  const feed = useNotificationFeed(onUnreadCount);
  const { show: showActionError } = useApiErrorDisplay();
  const loadError = useSwrLoadError(feed.error, "die Hinweise", feed.retry);
  const markingAll = useRef(false);

  const { loadMore, loadingMore, hasMore } = feed;
  const sentinel = useOnVisible(
    () => void loadMore(),
    hasMore && !loadingMore && !feed.error,
  );

  const open = useCallback(
    (item: NotificationFeedItem) => {
      void feed.markRead(item);
      if (schoolId) {
        trackTenantEvent(
          "notification_feed_entry_clicked",
          schoolId,
          ANALYTICS_TYPES.has(item.entry.type)
            ? { notification_type: item.entry.type }
            : undefined,
        );
      }
      const link = item.entry.deepLink;
      // Ein Link, der nicht in moto bleibt, führt nirgendwohin; der Eintrag
      // ist trotzdem gelesen.
      if (!link || !isSafeAppRelativePath(link)) return;
      onNavigate();
      router.push(resolveLink(link));
    },
    [feed, onNavigate, resolveLink, router, schoolId],
  );

  const markAllRead = useCallback(async () => {
    if (markingAll.current) return;
    markingAll.current = true;
    try {
      await feed.markAllRead();
      if (schoolId) trackTenantEvent("notification_feed_all_read", schoolId);
    } catch (error) {
      void showActionError(error, {
        object: "das Markieren als gelesen",
        retry: () => void markAllRead(),
      });
    } finally {
      markingAll.current = false;
    }
  }, [feed, schoolId, showActionError]);

  const hasUnread = unreadCount > 0 || feed.items.some((item) => item.unread);

  return (
    <section aria-label="Hinweise">
      <ListGroupHeader
        title="Hinweise"
        meta={
          hasUnread ? (
            <Button
              type="button"
              variant="link"
              size="compact"
              onClick={() => void markAllRead()}
              tooltip="Markiert sofort alle Hinweise als gelesen."
            >
              Alle als gelesen markieren
            </Button>
          ) : undefined
        }
      />
      {loadError ? <LoadErrorAlert error={loadError} className="m-3" /> : null}
      {feed.loading ? (
        <Loading compact message="Hinweise werden geladen." />
      ) : null}
      {!feed.loading && !feed.error && feed.items.length === 0 ? (
        <EmptyState
          variant="compact"
          title="Keine Hinweise."
          description="Hier steht zum Beispiel, wenn einer Ihrer Termine ausfällt."
          className="px-4 py-4"
        />
      ) : null}
      {feed.items.length > 0 ? (
        <ul className="divide-y divide-gray-100">
          {feed.items.map((item) => (
            <li key={item.entry.id}>
              <ListRowLink
                onClick={() => open(item)}
                title={item.entry.title}
                subtitle={item.entry.body}
                wrapSubtitle
                overline={item.unread ? "Neu" : undefined}
                meta={formatChatTime(item.entry.updatedAt)}
                unread={item.unread}
                chevron={isSafeAppRelativePath(item.entry.deepLink)}
              />
            </li>
          ))}
        </ul>
      ) : null}
      {hasMore && !feed.loading ? (
        <div ref={sentinel.ref} className="p-2">
          <Button
            type="button"
            variant="ghost"
            size="compact"
            className="w-full"
            onClick={() => void loadMore()}
            isLoading={loadingMore}
            loadingText="Weitere Hinweise werden geladen."
            tooltip="Zeigt ältere Hinweise."
          >
            Weitere laden
          </Button>
        </div>
      ) : null}
    </section>
  );
}
