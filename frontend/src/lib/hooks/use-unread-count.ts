"use client";

import { useCallback, useEffect, useState } from "react";
import { useSWRAuth } from "~/lib/swr";

/**
 * Shared badge hook: one count read through the shared cache (useSWRAuth),
 * refreshed by window events and on focus. Used by the badges of the staff,
 * parents and school portals. (The operator badge keeps its own hook: it
 * reads a two-field breakdown and listens to two events, a contract this
 * single-count hook deliberately does not model.)
 *
 * What the cache gives every badge: one request for all readers of a key
 * (the sidebar, the mobile navigation and the home blocks share one answer),
 * the scope lock (a key belongs to portal, school and account, a session
 * boundary drops the cache, a late answer of the session before is
 * discarded), and the server seed of the tenant shell (shellOwnedEntries in
 * `app/[tenant]/providers.tsx`): a seeded key is the first answer, without a
 * request on mount.
 */

interface BaseOptions<T> {
  /** Only read and listen while true (auth/portal-mode/feature gate). */
  enabled: boolean;
  /** Loads the resource. May be a fresh closure each render. */
  fetcher: () => Promise<T>;
  /** Window events that trigger a revalidation. */
  eventNames?: readonly string[];
  /**
   * Debounce event-driven (SSE) revalidations by N ms so a burst collapses
   * into one request. The messaging fan-out wakes every badge once per
   * message tenant-wide. Omit (or 0) to revalidate on every event.
   */
  eventDebounceMs?: number;
  /** Also revalidate when the window regains focus. */
  refetchOnFocus?: boolean;
  /** Error handler; by default the shared reader logs the failure. */
  onError?: (error: unknown) => void;
}

type CountOf<T> = [T] extends [number]
  ? { count?: (data: T) => number }
  : {
      /** The badge number of a resource that is not itself a count. */
      count: (data: T) => number;
    };

export type UseUnreadCountOptions<T = number> = BaseOptions<T> & CountOf<T>;

/** What a badge hook hands its navigation. */
export interface UseUnreadCountResult {
  unreadCount: number;
  isLoading: boolean;
  /** Revalidates the key. */
  refresh: () => Promise<void>;
}

/** The reader state a badge derives more than its count from. */
export interface UnreadCountReader extends UseUnreadCountResult {
  /** Whether the current key holds an answer of this session. */
  loaded: boolean;
  /** The failure of the latest request of the current key. */
  error: unknown;
}

/** Keys whose event-driven revalidation is in flight, for all their readers. */
const eventRevalidations = new Set<string>();

/**
 * @param key - Unscoped key of a factory in ~/lib/swr (`shellResourceKeys`,
 *   `parentKeys`); null reads nothing. One key per badge resource: a page
 *   that shows the same number reads the same key.
 */
export function useUnreadCount<T = number>(
  key: string | null,
  options: UseUnreadCountOptions<T>,
): UnreadCountReader {
  const {
    enabled,
    fetcher,
    eventNames,
    eventDebounceMs,
    refetchOnFocus = false,
    onError,
  } = options;
  const count = (options as { count?: (data: T) => number }).count;
  const readKey = enabled ? key : null;
  // A seeded or cached count is the answer on mount: no request. Once the
  // gate was closed (mounted disabled, or switched off since), the next
  // opening loads its count from the server: the seed or entry from before
  // may predate whatever closed and reopened the gate (a feature flag, a
  // module booking).
  const [trustsCache, setTrustsCache] = useState(readKey !== null);
  if (trustsCache && readKey === null) setTrustsCache(false);
  const { data, error, isLoading, mutate } = useSWRAuth<T, unknown>(
    readKey,
    fetcher,
    {
      revalidateIfStale: !trustsCache,
      revalidateOnFocus: refetchOnFocus,
      // After a switch of account or school, never the previous key's count,
      // not even until the first answer.
      keepPreviousData: false,
      ...(onError ? { onError } : {}),
    },
  );

  // Stable string key so the listener effect only re-runs when the set of
  // event names actually changes, not on every render's fresh array. The
  // effect only revalidates the reader above; it reads nothing itself.
  const eventKey = (eventNames ?? []).join("|");
  useEffect(() => {
    if (readKey === null || !eventKey) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const revalidate = () => {
      timer = null;
      // Every reader of a key hears the event; one request answers them all.
      if (eventRevalidations.has(readKey)) return;
      eventRevalidations.add(readKey);
      void mutate().finally(() => eventRevalidations.delete(readKey));
    };
    const handleEvent = () => {
      if (eventDebounceMs && eventDebounceMs > 0) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(revalidate, eventDebounceMs);
      } else {
        revalidate();
      }
    };
    const names = eventKey.split("|");
    names.forEach((name) => window.addEventListener(name, handleEvent));
    return () => {
      names.forEach((name) => window.removeEventListener(name, handleEvent));
      if (timer) clearTimeout(timer);
    };
  }, [readKey, eventKey, eventDebounceMs, mutate]);

  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  const loaded = readKey !== null && data !== undefined;
  let unreadCount = 0;
  if (loaded) unreadCount = count ? count(data) : (data as number);
  return {
    unreadCount,
    isLoading: readKey !== null && isLoading,
    refresh,
    loaded,
    error: readKey === null ? undefined : error,
  };
}
