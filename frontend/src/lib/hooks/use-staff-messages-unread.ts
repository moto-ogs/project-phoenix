"use client";

import { useSession } from "next-auth/react";
import { fetchStaffUnreadCount } from "~/lib/staff-messages-api";
import { useShellAuth } from "~/lib/shell-auth-context";
import { shellResourceKeys } from "~/lib/swr/shell-keys";
import { useTenantSafe } from "~/lib/tenant-context";
import { useUnreadCount, type UseUnreadCountResult } from "./use-unread-count";

/**
 * Unread badge for the OGS-internal Team-Chat (#2598). Mirrors
 * useMessagesUnread, with two differences: it reads the staff-messaging feature
 * flag rather than the parent one, and it listens on its own refresh event so a
 * parent message never nudges the team badge (or vice versa).
 */
export function useStaffMessagesUnread(): UseUnreadCountResult {
  const { data: session, status } = useSession();
  // The endpoint is tenant-scoped: TenantMiddleware rejects parent and operator
  // tokens with 401. Only fetch in the tenant-staff shell.
  const { mode } = useShellAuth();
  // Tying `enabled` to the flag means switching the chat off re-runs the hook
  // and clears the badge immediately, instead of leaving a non-zero count
  // until an unrelated refresh.
  const chatEnabled = useTenantSafe()?.tenant?.staffMessagingEnabled === true;
  // The shared cache scopes the key by school and account, so two staff users
  // sharing a browser never see each other's badge, and a tenant switch never
  // surfaces the previous school's count.
  const accountId = session?.user?.id;
  return useUnreadCount(
    accountId ? shellResourceKeys.teamChatUnread(accountId) : null,
    {
      enabled:
        status === "authenticated" &&
        mode === "teacher" &&
        !!accountId &&
        chatEnabled,
      fetcher: fetchStaffUnreadCount,
      eventNames: ["team-messages-unread-refresh"],
      // Collapse a burst of messages into one count refetch.
      eventDebounceMs: 500,
      // SSE stops reconnecting after maxReconnectAttempts and stays "failed"; if
      // that happens while the tab is backgrounded no refresh event fires and the
      // badge would stay stale until a full reload. A focus refetch heals it.
      refetchOnFocus: true,
    },
  );
}
