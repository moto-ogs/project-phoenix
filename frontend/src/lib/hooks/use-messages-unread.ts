"use client";

import { useSession } from "next-auth/react";
import { hasPermission } from "~/lib/auth-utils";
import { fetchUnreadCount } from "~/lib/parent-messages-api";
import { useShellAuth } from "~/lib/shell-auth-context";
import { shellResourceKeys } from "~/lib/swr/shell-keys";
import { useModuleBooked, useTenantSafe } from "~/lib/tenant-context";
import { useUnreadCount, type UseUnreadCountResult } from "./use-unread-count";

export function useMessagesUnread(): UseUnreadCountResult {
  const { data: session, status } = useSession();
  // The staff inbox endpoint is tenant-scoped: TenantMiddleware rejects parent
  // and operator (scope != "") tokens with 401. Only fetch in the tenant-staff
  // shell so the parents/operator portals never hit it.
  const { mode } = useShellAuth();
  // Messaging shares the operations.parent_notes_enabled gate, resolved onto the
  // tenant context (TenantInfo.messagingEnabled) and re-resolved whenever the
  // tenant provider sees phoenix:tenant-settings-stale (operator toggles the
  // setting). Tying `enabled` to it means flipping messaging off re-runs the
  // hook and clears the badge to 0 immediately, instead of leaving a
  // non-zero count until an unrelated refresh; and
  // re-enabling re-fetches the real count once the flag re-resolves.
  // Elternnachrichten gehören zum Modul Eltern-App (#4894).
  const elternAppBooked = useModuleBooked("eltern_app");
  const messagingEnabled = useTenantSafe()?.tenant?.messagingEnabled === true;
  const messagesAvailable = messagingEnabled && elternAppBooked;
  // The count is computed for the current account and its student-read scope.
  // The shared cache scopes the key by school and account: two staff users
  // sharing a browser never see each other's badge, and a tenant switch never
  // surfaces the previous school's count. The key is the one the tenant layout
  // seeds from the server; while messaging is unavailable nothing reads it.
  const accountId = session?.user?.id;
  return useUnreadCount(
    accountId ? shellResourceKeys.messagesUnread(accountId) : null,
    {
      // The inbox requires users:read; the role „AG-Leitung“ (#4573) lacks it.
      enabled:
        status === "authenticated" &&
        mode === "teacher" &&
        !!accountId &&
        messagesAvailable &&
        hasPermission(session, "users:read"),
      fetcher: fetchUnreadCount,
      eventNames: ["messages-unread-refresh"],
      // Collapse the tenant-wide message fan-out into one count refetch per burst.
      eventDebounceMs: 500,
      // Refetch on focus, matching the parent badge. SSE stops reconnecting after
      // maxReconnectAttempts and stays "failed"; if that happens while the tab is
      // backgrounded, no messages-unread-refresh event fires for a new message and
      // the badge would stay stale until a full reload. A focus refetch heals it
      // when the staffer returns to the tab.
      refetchOnFocus: true,
    },
  );
}
