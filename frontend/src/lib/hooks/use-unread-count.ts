"use client";

import { useCallback, useEffect, useState } from "react";
import { isReadRefusal } from "~/lib/access-refusal";
import { onSWRScopeReset, useSWRAuth, useSWRCacheKey } from "~/lib/swr";
import { useRefusalGuard } from "./use-confirmed-resource";

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

/**
 * What is known about the number (#8268). A badge shows `unreadCount` and
 * stays neutral without a confirmed one; a summary that says „nothing is
 * waiting" needs every applicable source `known`.
 *
 * - `inactive`: the source does not apply to this person: gate closed
 *   (right, module, portal) or a refusal of the read is in force, also when
 *   a later read of the key failed otherwise. Never shown as a failure, so
 *   a refusal reveals nothing.
 * - `loading`: no answer of this session yet.
 * - `failed`: the read failed and no answer of this session is held.
 * - `known`: a confirmed answer, also while a later refresh failed: SWR
 *   keeps it, and a failure never turns it into a 0.
 */
export type UnreadCountState = "inactive" | "loading" | "failed" | "known";

/** What a badge hook hands its navigation. */
export interface UseUnreadCountResult {
  /** The confirmed count; 0 for every state but `known`. */
  unreadCount: number;
  isLoading: boolean;
  state: UnreadCountState;
  /**
   * The failure of the latest read of the key. Shown only in `failed`: a
   * refusal belongs to `inactive`, a held answer outranks it in `known`.
   */
  error?: unknown;
  /** Revalidates the key. */
  refresh: () => Promise<void>;
}

/** The reader state a badge derives more than its count from. */
export interface UnreadCountReader extends UseUnreadCountResult {
  /** Whether the current key holds an answer of this session. */
  loaded: boolean;
}

/** Keys whose event-driven revalidation is in flight, for all their readers. */
interface EventRevalidation {
  events: WeakSet<Event>;
  pending: boolean;
  refresh: () => Promise<unknown>;
}
const eventRevalidations = new Map<string, EventRevalidation>();
onSWRScopeReset(() => eventRevalidations.clear());

/**
 * @param key - Unscoped key of a factory in ~/lib/swr (`shellResourceKeys`,
 *   `parentKeys`); null reads nothing. One key per badge resource: a page
 *   that shows the same number reads the same key.
 */
export function useUnreadCount<T = number>(
  key: string | null,
  options: UseUnreadCountOptions<T>,
): UnreadCountReader {
  const { enabled, fetcher, eventNames, eventDebounceMs, onError } = options;
  const count = (options as { count?: (data: T) => number }).count;
  const readKey = enabled ? key : null;
  const cacheKey = useSWRCacheKey();
  const eventReadKey = readKey === null ? null : cacheKey(readKey);
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
      // Recover badges that missed events while the browser was backgrounded.
      revalidateOnFocus: true,
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
    if (eventReadKey === null || !eventKey) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const revalidate = (event: Event) => {
      timer = null;
      const running = eventRevalidations.get(eventReadKey);
      if (running) {
        // All readers hear the same event. Only a NEW event queues a trailing
        // refresh, including when several arrive while the request is running.
        if (!running.events.has(event)) {
          running.events.add(event);
          running.pending = true;
        }
        running.refresh = mutate;
        return;
      }
      const flight: EventRevalidation = {
        events: new WeakSet([event]),
        pending: false,
        refresh: mutate,
      };
      eventRevalidations.set(eventReadKey, flight);
      void (async () => {
        try {
          do {
            flight.pending = false;
            await flight.refresh();
          } while (
            flight.pending &&
            eventRevalidations.get(eventReadKey) === flight
          );
        } finally {
          if (eventRevalidations.get(eventReadKey) === flight) {
            eventRevalidations.delete(eventReadKey);
          }
        }
      })();
    };
    const handleEvent = (event: Event) => {
      if (eventDebounceMs && eventDebounceMs > 0) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => revalidate(event), eventDebounceMs);
      } else {
        revalidate(event);
      }
    };
    const names = eventKey.split("|");
    names.forEach((name) => window.addEventListener(name, handleEvent));
    return () => {
      names.forEach((name) => window.removeEventListener(name, handleEvent));
      if (timer) clearTimeout(timer);
    };
  }, [eventReadKey, eventKey, eventDebounceMs, mutate]);

  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  const loaded = readKey !== null && data !== undefined;
  let unreadCount = 0;
  if (loaded) unreadCount = count ? count(data) : (data as number);
  const shownError = readKey === null ? undefined : error;
  const { refusal } = useRefusalGuard(readKey);
  return {
    unreadCount,
    isLoading: readKey !== null && isLoading,
    state: unreadCountState(readKey, loaded, shownError, refusal),
    refresh,
    loaded,
    error: shownError,
  };
}

/**
 * The state of a count read through useSWRAuth under `readKey` (null while
 * the gate is closed). `refusal` is the key's refusal in force
 * (useRefusalGuard): it outlasts a later failure of another kind. Shared
 * with the badges that read SWR themselves.
 */
export function unreadCountState(
  readKey: string | null,
  loaded: boolean,
  error: unknown,
  refusal: unknown,
): UnreadCountState {
  if (readKey === null) return "inactive";
  // useSWRAuth withdraws the data of a refused key, so a refusal is checked
  // before the answer.
  if (refusal !== undefined || isReadRefusal(error)) return "inactive";
  if (loaded) return "known";
  return error === undefined ? "loading" : "failed";
}
