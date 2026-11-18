"use client";

// Die Liste der Hinweise einer Glocke (#7148, #7140): Staff-Portal und
// Elternportal teilen sie. Das Portal gibt die Quelle, die Texte in seiner
// Sprache, die Navigation und die Nutzungsanalyse mit.

import { useCallback, useRef } from "react";

import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { ListGroupHeader } from "~/components/ui/list-group-header";
import { ListRowLink } from "~/components/ui/list-row-link";
import { Loading } from "~/components/ui/loading";
import { useApiErrorDisplay } from "~/contexts/ToastContext";
import { formatChatTime } from "~/lib/date-helpers";
import {
  type NotificationFeedItem,
  type NotificationFeedSource,
  useNotificationFeed,
} from "~/lib/hooks/use-notification-feed";
import { useOnVisible } from "~/lib/hooks/use-on-visible";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { isSafeAppRelativePath } from "~/lib/notification-deep-link";

/** Die sichtbaren Texte der Liste, in der Sprache des Portals. */
export interface NotificationFeedCopy {
  readonly section: string;
  readonly markAllRead: string;
  readonly markAllReadTooltip: string;
  /** Wird im Satz der Fehlermeldung genannt („… konnte nicht …“). */
  readonly markAllReadErrorObject: string;
  readonly loadErrorObject: string;
  readonly loading: string;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly unread: string;
  readonly loadMore: string;
  readonly loadingMore: string;
  readonly loadMoreTooltip: string;
}

export function NotificationFeedList({
  source,
  copy,
  locale,
  unreadCount,
  onUnreadCount,
  navigate,
  onEntryClicked,
  onAllRead,
}: Readonly<{
  source?: NotificationFeedSource;
  copy: NotificationFeedCopy;
  /** Sprache der Zeitangabe; ohne Angabe Deutsch. */
  locale?: string;
  unreadCount: number;
  onUnreadCount: (count: number) => void;
  /** Öffnet einen app-relativen Link; die Glocke schließt sich davor. */
  navigate: (link: string) => void;
  /** Für die Nutzungsanalyse, ohne Inhalt und ohne IDs. */
  onEntryClicked?: (type: string) => void;
  onAllRead?: () => void;
}>) {
  const feed = useNotificationFeed(onUnreadCount, source);
  const { show: showActionError } = useApiErrorDisplay();
  const loadError = useSwrLoadError(
    feed.error,
    copy.loadErrorObject,
    feed.retry,
  );
  const markingAll = useRef(false);

  const { loadMore, loadingMore, hasMore } = feed;
  const sentinel = useOnVisible(
    () => void loadMore(),
    hasMore && !loadingMore && !feed.error,
  );

  const open = useCallback(
    (item: NotificationFeedItem) => {
      void feed.markRead(item);
      onEntryClicked?.(item.entry.type);
      const link = item.entry.deepLink;
      // Ein Link, der nicht in moto bleibt, führt nirgendwohin; der Eintrag
      // ist trotzdem gelesen.
      if (!link || !isSafeAppRelativePath(link)) return;
      navigate(link);
    },
    [feed, navigate, onEntryClicked],
  );

  const markAllRead = useCallback(async () => {
    if (markingAll.current) return;
    markingAll.current = true;
    try {
      await feed.markAllRead();
      onAllRead?.();
    } catch (error) {
      void showActionError(error, {
        object: copy.markAllReadErrorObject,
        retry: () => void markAllRead(),
      });
    } finally {
      markingAll.current = false;
    }
  }, [feed, onAllRead, showActionError, copy.markAllReadErrorObject]);

  const hasUnread = unreadCount > 0 || feed.items.some((item) => item.unread);

  return (
    <section aria-label={copy.section}>
      <ListGroupHeader
        title={copy.section}
        meta={
          hasUnread ? (
            <Button
              type="button"
              variant="link"
              size="compact"
              onClick={() => void markAllRead()}
              tooltip={copy.markAllReadTooltip}
            >
              {copy.markAllRead}
            </Button>
          ) : undefined
        }
      />
      {loadError ? <LoadErrorAlert error={loadError} className="m-3" /> : null}
      {feed.loading ? <Loading compact message={copy.loading} /> : null}
      {!feed.loading && !feed.error && feed.items.length === 0 ? (
        <EmptyState
          variant="compact"
          title={copy.emptyTitle}
          description={copy.emptyDescription}
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
                overline={feedEntryOverline(item, copy.unread)}
                meta={formatChatTime(item.entry.updatedAt, locale)}
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
            loadingText={copy.loadingMore}
            tooltip={copy.loadMoreTooltip}
          >
            {copy.loadMore}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Die Zeile über dem Titel: „Neu“ für einen ungelesenen Eintrag und, wo die
 * Glocke mehrere Schulen zeigt (Träger-Portal, #7146), die Schule.
 */
function feedEntryOverline(
  item: NotificationFeedItem,
  unread: string,
): string | undefined {
  const parts = [item.unread ? unread : null, item.entry.schoolName].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length > 0 ? parts.join(" · ") : undefined;
}
