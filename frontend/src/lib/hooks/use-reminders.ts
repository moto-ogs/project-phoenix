"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { hasPermission } from "~/lib/auth-utils";
import { useScopedSWRKey, useSWRAuth } from "~/lib/swr/hooks";
import { shellResourceKeys } from "~/lib/swr/shell-keys";
import { fetchReminders, type RemindersResult } from "~/lib/reminders-api";

// 60s tick when the feature is on: time-based reminders ("in 10 min") cross
// their threshold purely by time passing, with no backend event — so we
// re-evaluate on a fixed cadence.
const ACTIVE_REFRESH_INTERVAL_MS = 60 * 1000;

// All reminder types default OFF, so most tenants never enable the feature. A
// disabled tenant has no time-based thresholds to catch, so there is no reason
// to poll every minute — we only need to notice, eventually, when an admin
// switches a type on (the admin's own tab flips instantly via the settings-page
// mutate; other open tabs discover it on this slower tick). Polling every 5 min
// in the disabled case cuts the pointless background load ~5x.
const IDLE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

// Small cushion added to the scheduled refresh so the server-side minute
// boundary has definitely elapsed before we refetch: next_change_at is the top
// of a wall-clock minute, and client/server clocks can drift by a second or two.
const NEXT_CHANGE_BUFFER_MS = 2000;

// When the flagged boundary is already in the past (client clock skew, or the
// timer resolving at the exact minute), refetch after this short delay rather
// than a whole day later.
const PAST_BOUNDARY_REFETCH_MS = 500;

// The backend reports next_change_at in Berlin wall-clock time (formatMinutes on
// timezone.Now()), so the timer delay must be measured against Berlin time, NOT
// the browser's local zone. A device on a different timezone (traveling staff, a
// misconfigured tablet, a UTC browser) would otherwise schedule the refetch at
// the wrong instant. Intl resolves the offset — including DST — for us.
const BERLIN_TIME_ZONE = "Europe/Berlin";

const BERLIN_TIME_PARTS_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: BERLIN_TIME_ZONE,
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const BERLIN_DATE_TIME_PARTS_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: BERLIN_TIME_ZONE,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

// berlinSecondsOfDay returns the current wall-clock time in Europe/Berlin as
// seconds since local midnight (0..86399), independent of the browser's own
// timezone.
function berlinSecondsOfDay(now: Date): number {
  const parts = BERLIN_TIME_PARTS_FORMATTER.formatToParts(now);
  const value = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  // Some engines render midnight as "24" under hour12:false; normalize to 0.
  const hour = value("hour") % 24;
  return hour * 3600 + value("minute") * 60 + value("second");
}

// berlinUtcOffsetSeconds returns Europe/Berlin's UTC offset in seconds at the
// given instant: +7200 in summer (CEST) or +3600 in winter (CET). Used to
// correct the scheduled delay across a DST transition (see nextChangeDelay).
//
// The offset is derived by formatting the instant as Berlin wall-clock fields
// and differencing that against the real instant. This relies only on Intl
// timeZone support (already required by berlinSecondsOfDay), NOT the newer
// "longOffset" option — so it stays correct on older WebViews instead of
// silently falling back to no DST correction (which would fire the refetch ~1h
// off on the two transition nights per year).
function berlinUtcOffsetSeconds(at: Date): number {
  const parts = BERLIN_DATE_TIME_PARTS_FORMATTER.formatToParts(at);
  const value = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  // Some engines render midnight as "24" under hour12:false; normalize to 0.
  const asUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour") % 24,
    value("minute"),
    value("second"),
  );
  return Math.round((asUtc - at.getTime()) / 1000);
}

// Same-day boundaries are HH:MM in Berlin. A later day's boundary includes
// its date and offset. A past boundary gets one prompt refresh, not a loop.
function nextChangeDelay(hhmm: string): number | null {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(hhmm)) {
    const targetMs = Date.parse(hhmm);
    if (Number.isNaN(targetMs)) return null;
    const realDeltaMs = targetMs - Date.now();
    return realDeltaMs <= 0
      ? PAST_BOUNDARY_REFETCH_MS
      : realDeltaMs + NEXT_CHANGE_BUFFER_MS;
  }
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  const targetSec = hours * 3600 + minutes * 60;
  const now = new Date();
  // wallDeltaSec is a wall-clock delta, but setTimeout counts real elapsed ms.
  // On a Berlin DST-transition day the two diverge by 3600s across the boundary
  // (spring-forward loses an hour, fall-back gains one), so a raw wall-clock
  // subtraction would fire ~1h early or late. Correct by the change in UTC
  // offset between now and the (estimated) target instant — Berlin's offset is
  // piecewise-constant, so a single estimate lands in the right region.
  const wallDeltaSec = targetSec - berlinSecondsOfDay(now);
  const offsetNow = berlinUtcOffsetSeconds(now);
  const estTarget = new Date(now.getTime() + wallDeltaSec * 1000);
  const offsetTarget = berlinUtcOffsetSeconds(estTarget);
  const realDeltaSec = wallDeltaSec - (offsetTarget - offsetNow);
  return realDeltaSec <= 0
    ? PAST_BOUNDARY_REFETCH_MS
    : realDeltaSec * 1000 + NEXT_CHANGE_BUFFER_MS;
}

// Readers of one scoped key share one event listener and one next_change_at
// timer (#5129). SWR dedupes the polls and focus refetches of its readers,
// but every explicit mutate() starts a request of its own: with a listener
// and a timer per reader, bell, home block and home page loaded three times
// per event. Each reader registers its own refresh, so the shared effect
// keeps running until the last reader unmounts.
interface SharedRefresh {
  refreshes: Set<() => unknown>;
  stop: () => void;
}

const sharedRefreshes = new Map<string, SharedRefresh>();

// shareRefresh starts `start` once per id and returns this reader's release.
// The effect refreshes through the reader that registered last.
function shareRefresh(
  id: string,
  refresh: () => unknown,
  start: (refresh: () => void) => () => void,
): () => void {
  let shared = sharedRefreshes.get(id);
  if (!shared) {
    const refreshes = new Set<() => unknown>();
    const stop = start(() => {
      void [...refreshes].at(-1)?.();
    });
    shared = { refreshes, stop };
    sharedRefreshes.set(id, shared);
  }
  const { refreshes, stop } = shared;
  refreshes.add(refresh);
  return () => {
    refreshes.delete(refresh);
    if (refreshes.size > 0) return;
    stop();
    sharedRefreshes.delete(id);
  };
}

/**
 * useReminders fetches the current visual reminders for the authenticated user.
 * The /reminders page renders the full list; the header bell reads the count
 * for its badge and previews the most urgent few. All readers share the same
 * SWR key and one refresh per event (see shareRefresh).
 */
export function useReminders() {
  // GET /api/reminders verlangt users:read. Ohne das Recht (AG-Leitung,
  // #4573) fragt niemand: jede Abfrage wäre ein sicheres 403, und das alle
  // 60 Sekunden aus Glocke, Startseite und Liste.
  const { data: session } = useSession();
  const canRead = hasPermission(session, "users:read");
  const { data, error, isLoading, mutate } = useSWRAuth<RemindersResult>(
    canRead ? shellResourceKeys.reminders() : null,
    fetchReminders,
    {
      refreshInterval: (latest) =>
        latest?.enabled ? ACTIVE_REFRESH_INTERVAL_MS : IDLE_REFRESH_INTERVAL_MS,
      // The global SWR config disables focus revalidation (SSE covers most
      // freshness). Reminders are the exception: a backgrounded tab pauses the
      // refreshInterval poll entirely, so without this a threshold crossed while
      // the tab was hidden would not surface until a manual reload. Re-enable it
      // for this key so returning to the tab refetches immediately.
      revalidateOnFocus: true,
      // The header bell keeps this entry current from the shell seed on
      // (poll, SSE event, focus, next_change_at timer). A second reader that
      // mounts later, the home block on every visit, shows that entry instead
      // of fetching the shell endpoint again (#4989). Without cached data the
      // first reader still fetches.
      revalidateIfStale: false,
    },
  );

  const enabled = data?.enabled ?? false;
  const nextChangeAt = data?.next_change_at;
  const resource = useScopedSWRKey(shellResourceKeys.reminders());

  // Event-driven refresh. useGlobalSSE() does not own the tenant-prefixed
  // reminders SWR key, so it dispatches
  // "phoenix:reminders-stale" whenever an attendance / activity / student-data
  // change may alter what's due (or who may see it). Revalidate here, where the
  // SWR key is correctly tenant-scoped via useSWRAuth. Gate on `enabled`: a
  // disabled tenant has nothing to recompute, so keep its cheap 5-min idle poll
  // rather than react to every attendance burst. One listener per scoped key.
  useEffect(() => {
    if (!enabled || resource === null) return;
    return shareRefresh(`${resource}:stale`, mutate, (refresh) => {
      window.addEventListener("phoenix:reminders-stale", refresh);
      return () =>
        window.removeEventListener("phoenix:reminders-stale", refresh);
    });
  }, [enabled, resource, mutate]);

  // One timer per scoped key and boundary. The refreshed response drives the
  // next timer. Focus and polling cover suspended tabs and larger clock skew.
  useEffect(() => {
    if (!enabled || resource === null || !nextChangeAt) return;
    return shareRefresh(
      `${resource}:next-change:${nextChangeAt}`,
      mutate,
      (refresh) => {
        const delay = nextChangeDelay(nextChangeAt);
        if (delay === null) return () => undefined;
        const timer = setTimeout(refresh, delay);
        return () => clearTimeout(timer);
      },
    );
  }, [enabled, resource, nextChangeAt, mutate]);

  return {
    reminders: data?.reminders ?? [],
    count: data?.count ?? 0,
    enabled,
    // Raw payload so consumers can distinguish "loaded and disabled"
    // (data.enabled === false) from "not loaded yet" (data undefined) — the
    // /reminders route guard needs that to avoid redirecting during the initial
    // load / no-token window, where the derived `enabled` is falsy too.
    data,
    error,
    isLoading,
    /** Lädt neu, etwa für Wiederholen an einem Ladefehler. */
    retry: () => mutate(),
  };
}
