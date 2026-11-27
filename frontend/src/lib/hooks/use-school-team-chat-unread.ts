"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { schoolStaffMessagesApi } from "~/lib/school-staff-messages-api";
import { isStaffMessagingDisabled } from "~/lib/staff-messages-api";
import { shellResourceKeys } from "~/lib/swr/shell-keys";
import { useUnreadCount } from "./use-unread-count";

/**
 * Unread badge AND availability of the Team-Chat in the school portal
 * (#2208). The OGS portal reads the feature flag from its cached tenant
 * metadata; the school portal has no such cache, so the count read doubles
 * as the probe: a `communication.staff_messaging_disabled` answer hides the
 * navigation entry instead of leaving a dead link.
 *
 * `available` is null until the probe answered — the navigation renders the
 * entry only once it knows, so a switched-off school never sees it flash.
 *
 * A transient failure (offline, 500, a request that raced a token refresh) is
 * NOT an answer: it would otherwise leave `available` at null and hide the
 * Team-Chat for the rest of the session, because nothing re-probes on its own
 * before the next focus or SSE event once the shared reader stopped retrying.
 * Such a failure schedules its own retry with a growing delay, so the entry
 * appears as soon as the backend answers again.
 * `communication.staff_messaging_disabled` is a real answer and stops the
 * retries.
 *
 * Both values are bound to the authenticated school session (school +
 * account): they come from one entry of the shared cache, whose key the
 * session scope prefixes and whose cache a session boundary drops.
 * SchoolShell stays mounted across a session change; the new session starts
 * without a count and with `available` at null.
 */

const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000] as const;

export interface SchoolTeamChatUnread {
  unreadCount: number;
  available: boolean | null;
}

export function useSchoolTeamChatUnread(): SchoolTeamChatUnread {
  const { status } = useSession();
  const { unreadCount, refresh, loaded, error } = useUnreadCount(
    shellResourceKeys.schoolTeamChatUnread(),
    {
      enabled: status === "authenticated",
      fetcher: schoolStaffMessagesApi.fetchUnreadCount,
      eventNames: ["team-messages-unread-refresh"],
      eventDebounceMs: 500,
      // A switched-off Team-Chat is an answer, not a failure to log.
      onError: () => undefined,
    },
  );

  const disabled = error !== undefined && isStaffMessagingDisabled(error);
  const available = disabled ? false : loaded ? true : null;

  // Transient failure without an answer: ask again, with a growing delay,
  // until the backend answers one way or the other. The final delay repeats
  // for the rest of the session rather than giving up on the navigation
  // entry. Every failed attempt is a new error and schedules the next one;
  // the effect only revalidates the reader, it reads nothing itself.
  const attemptRef = useRef(0);
  const waiting = available === null && error !== undefined;
  useEffect(() => {
    if (!waiting) {
      attemptRef.current = 0;
      return;
    }
    const attempt = attemptRef.current;
    attemptRef.current = Math.min(attempt + 1, RETRY_DELAYS_MS.length - 1);
    const timer = setTimeout(
      () => void refresh(),
      RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1],
    );
    return () => clearTimeout(timer);
  }, [waiting, error, refresh]);

  return { unreadCount, available };
}
