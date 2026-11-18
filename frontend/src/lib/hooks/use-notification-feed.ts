"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchNotificationFeed,
  fetchNotificationFeedUnreadCount,
  markAllNotificationFeedRead,
  markNotificationFeedEntryRead,
  NOTIFICATION_FEED_REFRESH_EVENT,
  type NotificationFeedApi,
  parentNotificationFeedApi,
} from "~/lib/notification-feed-api";
import type { NotificationFeedEntry } from "~/lib/notification-feed-helpers";
import { useNotificationFeedPortal } from "~/lib/notification-feed-portal";
import { onSWRScopeReset, useLiveRefreshInterval, useSWRAuth } from "~/lib/swr";
import { parentKeys } from "~/lib/swr/parent-keys";
import {
  catererKeys,
  notificationFeedKeys,
  schoolPortalKeys,
} from "~/lib/swr/portal-keys";
import { traegerKeys } from "~/lib/swr/traeger-keys";

/** Woher eine Glocke ihren Feed liest: das Portal und seine Aufrufe. */
export interface NotificationFeedSource {
  readonly portal: "parent";
  readonly api: NotificationFeedApi;
}

/** Der Feed des Elternportals über alle Schulen der Familie (#7140). */
export const PARENT_NOTIFICATION_FEED: NotificationFeedSource = {
  api: parentNotificationFeedApi,
  portal: "parent",
};

// Ohne verbundenen Live-Kanal holt die Glocke den Stand jede Minute; mit
// Kanal reicht der Abgleich alle fünf Minuten (useLiveRefreshInterval).
const FEED_FALLBACK_INTERVAL_MS = 60 * 1000;

// Das Live-Ereignis zu einem Gelesen-Status kann kurz vor dem Speichern
// eintreffen (#7148); ein Abruf erst nach einer kurzen Pause sieht den
// gespeicherten Stand und fasst mehrere Ereignisse zu einem Abruf zusammen.
const NOTIFICATION_FEED_REFRESH_DELAY_MS = 500;

/** Ruft `refresh` nach dem letzten Live-Ereignis einer kurzen Folge auf. */
function onFeedRefresh(refresh: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const handle = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      refresh();
    }, NOTIFICATION_FEED_REFRESH_DELAY_MS);
  };
  window.addEventListener(NOTIFICATION_FEED_REFRESH_EVENT, handle);
  return () => {
    if (timer) clearTimeout(timer);
    window.removeEventListener(NOTIFICATION_FEED_REFRESH_EVENT, handle);
  };
}

/**
 * Zähler der ungelesenen Hinweise für das Abzeichen der Glocke (#7148). Die
 * Glocke ist immer da; sie lädt nur diese Zahl, die Liste erst beim Öffnen.
 * `notification_feed_changed` (auch von einem anderen Gerät) und ein
 * Wiederverbinden lösen über ein Fenster-Ereignis einen neuen Abruf aus.
 */
export function useNotificationFeedUnread(
  /** Nur in Portalen mit Glocke; die untere Leiste dient auch anderen. */
  enabled = true,
  source?: NotificationFeedSource,
) {
  const portal = useNotificationFeedPortal();
  const { apiBase } = portal;
  const refreshInterval = useLiveRefreshInterval(FEED_FALLBACK_INTERVAL_MS);
  const { data, mutate } = useSWRAuth<number>(
    !enabled
      ? null
      : source
        ? parentKeys.notificationFeed.unreadCount()
        : portal.keyScope === "school"
          ? schoolPortalKeys.notificationFeedUnread()
          : portal.keyScope === "traeger"
            ? traegerKeys.notificationFeedUnread()
            : portal.keyScope === "caterer"
              ? catererKeys.notificationFeedUnread()
              : notificationFeedKeys.unreadCount(),
    () =>
      source
        ? source.api.fetchUnreadCount()
        : fetchNotificationFeedUnreadCount(apiBase),
    {
      refreshInterval,
      // Ein verborgener Tab pollt nicht. Kommt er zurück, stimmt die Zahl
      // sofort wieder, auch wenn der Live-Kanal in der Zeit abgerissen ist.
      revalidateOnFocus: true,
    },
  );

  useEffect(
    () => (enabled ? onFeedRefresh(() => void mutate()) : undefined),
    [enabled, mutate],
  );

  const setUnreadCount = useCallback(
    (count: number) => void mutate(count, { revalidate: false }),
    [mutate],
  );

  return { unreadCount: enabled ? (data ?? 0) : 0, setUnreadCount };
}

export interface NotificationFeedItem {
  readonly entry: NotificationFeedEntry;
  readonly unread: boolean;
}

/**
 * Die Liste der Hinweise in der geöffneten Glocke: die erste Seite über SWR,
 * weitere Seiten beim Scrollen. Ein Live-Ereignis lädt die erste Seite neu
 * und verwirft die nachgeladenen: ein gebündelter Eintrag rückt nach oben,
 * ein alter Cursor zeigte danach auf die falsche Stelle.
 *
 * Gelesen wird ein Eintrag nur über `markRead` (Klick) oder `markAllRead`,
 * nie durch das Öffnen. Beides zeigt die Liste sofort gelesen; das Backend
 * schickt danach das Live-Ereignis, und die Liste lädt den bestätigten Stand.
 */
export function useNotificationFeed(
  onUnreadCount: (count: number) => void,
  source?: NotificationFeedSource,
) {
  const portal = useNotificationFeedPortal();
  const { apiBase } = portal;
  const [extra, setExtra] = useState<readonly NotificationFeedEntry[]>([]);
  // undefined: der nächste Cursor ist der der ersten Seite.
  const [extraCursor, setExtraCursor] = useState<string | null | undefined>(
    undefined,
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<unknown>(null);
  // Sofort gelesen gezeigt, bis die Liste den bestätigten Stand lädt: je ID
  // der Stand (updatedAt) beim Klick. Ein später aktualisierter oder neuer
  // Eintrag ist wieder ungelesen, auch nach „Alle als gelesen markieren“.
  const [locallyRead, setLocallyRead] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const [allReadUpTo, setAllReadUpTo] = useState<string | null>(null);
  // Überholte Seiten gehören weder zum neuen Listenstand noch zur Sitzung.
  const generation = useRef(0);
  const sessionGeneration = useRef(0);

  const resetPagination = useCallback(() => {
    generation.current += 1;
    setExtra([]);
    setExtraCursor(undefined);
    setLoadingMore(false);
    setLoadMoreError(null);
  }, []);

  useEffect(
    () =>
      onSWRScopeReset(() => {
        sessionGeneration.current += 1;
        resetPagination();
        setLocallyRead(new Map());
        setAllReadUpTo(null);
      }),
    [resetPagination],
  );

  const refreshInterval = useLiveRefreshInterval(FEED_FALLBACK_INTERVAL_MS);
  const first = useSWRAuth(
    source
      ? parentKeys.notificationFeed.firstPage()
      : portal.keyScope === "school"
        ? schoolPortalKeys.notificationFeedFirstPage()
        : portal.keyScope === "traeger"
          ? traegerKeys.notificationFeedFirstPage()
          : portal.keyScope === "caterer"
            ? catererKeys.notificationFeedFirstPage()
            : notificationFeedKeys.firstPage(),
    () => (source ? source.api.fetchPage() : fetchNotificationFeed(apiBase)),
    {
      refreshInterval,
      // Auch bei verlorenen Live-Ereignissen stimmen Seiten und Cursor
      // nach dem nächsten Abgleich wieder mit der ersten Seite überein.
      onSuccess: resetPagination,
    },
  );
  const firstMutate = first.mutate;
  // Die erste Seite bringt den Zähler mit: das Abzeichen übernimmt ihn, damit
  // Liste und Zahl nach einem Abruf zusammenpassen.
  const firstUnread = first.data?.unreadCount;
  useEffect(() => {
    if (firstUnread !== undefined) onUnreadCount(firstUnread);
  }, [firstUnread, onUnreadCount]);

  useEffect(
    () =>
      onFeedRefresh(() => {
        resetPagination();
        void firstMutate();
      }),
    [firstMutate, resetPagination],
  );

  const nextCursor =
    extraCursor === undefined ? (first.data?.nextCursor ?? null) : extraCursor;

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    const started = generation.current;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const page = source
        ? await source.api.fetchPage(nextCursor)
        : await fetchNotificationFeed(apiBase, nextCursor);
      if (generation.current !== started) return;
      setExtra((current) => [...current, ...page.entries]);
      setExtraCursor(page.nextCursor);
    } catch (error) {
      if (generation.current === started) setLoadMoreError(error);
    } finally {
      if (generation.current === started) setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, apiBase, source]);

  const items = useMemo((): readonly NotificationFeedItem[] => {
    const seen = new Set<string>();
    const result: NotificationFeedItem[] = [];
    for (const entry of [...(first.data?.entries ?? []), ...extra]) {
      // Ein Eintrag, der zwischen zwei Seiten nach oben rückte, steht nur
      // einmal da, in seiner neuesten Fassung (erste Seite zuerst).
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      const clickedAt = locallyRead.get(entry.id);
      const shownRead =
        (clickedAt !== undefined && !isNewer(entry.updatedAt, clickedAt)) ||
        (allReadUpTo !== null && !isNewer(entry.updatedAt, allReadUpTo));
      result.push({ entry, unread: entry.readAt === null && !shownRead });
    }
    return result;
  }, [first.data, extra, allReadUpTo, locallyRead]);

  const markRead = useCallback(
    async (item: NotificationFeedItem) => {
      if (!item.unread) return;
      const started = sessionGeneration.current;
      const { id, updatedAt } = item.entry;
      setLocallyRead((current) => new Map(current).set(id, updatedAt));
      try {
        const count = source
          ? await source.api.markRead(id)
          : await markNotificationFeedEntryRead(apiBase, id);
        if (sessionGeneration.current === started) onUnreadCount(count);
      } catch {
        if (sessionGeneration.current !== started) return;
        // Bewusst ohne Meldung: der Klick führt trotzdem zum Ziel, und der
        // Eintrag steht wieder als ungelesen da. Ein zweiter Klick versucht
        // es noch einmal.
        setLocallyRead((current) => {
          const next = new Map(current);
          next.delete(id);
          return next;
        });
      }
    },
    [onUnreadCount, apiBase, source],
  );

  /** Wirft bei einem Fehler; der Aufrufer zeigt ihn als Meldung. */
  const markAllRead = useCallback(async () => {
    const started = sessionGeneration.current;
    const upTo = latestUpdate(items);
    const count = source
      ? await source.api.markAllRead()
      : await markAllNotificationFeedRead(apiBase);
    if (sessionGeneration.current !== started) return;
    setAllReadUpTo(upTo);
    onUnreadCount(count);
  }, [items, onUnreadCount, apiBase, source]);

  const retry = useCallback(() => {
    if (first.error) {
      void firstMutate();
      return;
    }
    void loadMore();
  }, [first.error, firstMutate, loadMore]);

  return {
    items,
    loading: first.data === undefined && !first.error,
    loadingMore,
    hasMore: nextCursor !== null,
    error: first.error ?? loadMoreError ?? null,
    loadMore,
    retry,
    markRead,
    markAllRead,
  };
}

function isNewer(instant: string, than: string): boolean {
  return Date.parse(instant) > Date.parse(than);
}

function latestUpdate(items: readonly NotificationFeedItem[]): string | null {
  let latest: string | null = null;
  for (const { entry } of items) {
    if (latest === null || isNewer(entry.updatedAt, latest)) {
      latest = entry.updatedAt;
    }
  }
  return latest;
}
