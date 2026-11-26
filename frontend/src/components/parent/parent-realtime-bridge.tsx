"use client";

import { useParentResourceEvents } from "~/lib/hooks/use-parent-resources";
import { useCallback, useEffect, useRef } from "react";
import { useSSE } from "~/lib/hooks/use-sse";
import {
  dispatchPhoenixNotification,
  NOTIFICATION_FEED_REFRESH_EVENT,
} from "~/lib/notification-events";
import type { SSEEvent } from "~/lib/sse-types";

/**
 * Portal-wide SSE bridge for the parents app, mounted once in the authenticated
 * shell. The per-conversation chat has its own SSE handler, but a guardian
 * sitting on the dashboard or the multi-child messages list otherwise never
 * learned about new staff activity until they reopened a chat or refocused the
 * window — the unread badge and the list both only refetched on those triggers.
 *
 * On a parent_message trigger this dispatches the window events those surfaces
 * already listen on: `parent-messages-unread-refresh` (the sidebar unread badge
 * and shared message lists), and `parent-conversation-refresh`
 * carrying the affected studentId (an open OgsConversation). This is the SINGLE
 * SSE connection for the parents portal — surfaces react to these window events
 * rather than each opening its own EventSource to the same endpoint.
 *
 * Guardian-scoped notification events use the same phoenix:notification
 * dispatcher as the staff portal, so the root NotificationBridge renders them.
 *
 * A parent_message_read trigger (the OGS read this guardian's messages, or the
 * guardian read in another tab) refreshes the badge, the shared lists' unread
 * counts and the open conversation's "Gelesen" receipts. The backend emits it
 * only on a real cursor advance, so the conversation refetch cannot loop.
 * Renders nothing.
 */
export function ParentRealtimeBridge() {
  useParentResourceEvents();
  const handleSSE = useCallback((event: SSEEvent) => {
    if (typeof window === "undefined") return;
    if (event.type === "notification") {
      dispatchPhoenixNotification(event);
      return;
    }
    // Der Feed des Kontos änderte sich (#7140): neuer Hinweis oder ein
    // Gelesen-Status, auch von einem anderen Gerät. Die Glocke lädt Zähler
    // und Liste neu.
    if (event.type === "notification_feed_changed") {
      window.dispatchEvent(new CustomEvent(NOTIFICATION_FEED_REFRESH_EVENT));
      return;
    }
    if (event.type === "parent_message") {
      window.dispatchEvent(new CustomEvent("parent-messages-unread-refresh"));
      window.dispatchEvent(
        new CustomEvent("parent-conversation-refresh", {
          detail: { studentId: event.data?.student_id ?? null },
        }),
      );
      return;
    }
    if (event.type === "parent_message_read") {
      window.dispatchEvent(new CustomEvent("parent-messages-unread-refresh"));
      window.dispatchEvent(
        new CustomEvent("parent-conversation-refresh", {
          detail: { studentId: event.data?.student_id ?? null },
        }),
      );
      return;
    }
    if (event.type === "parent_child_updated") {
      // The shared status invalidation reaches mounted and unmounted care
      // readers. A conversation refresh would reload the same care keys twice.
      // No message changed, so leave conversations and unread state alone.
      window.dispatchEvent(
        new CustomEvent("parent-child-status-refresh", {
          detail: { studentId: event.data?.student_id ?? null },
        }),
      );
    }
  }, []);
  const { isConnected } = useSSE("/api/parent/sse/events", {
    onMessage: handleSSE,
  });
  const opened = useRef(false);
  useEffect(() => {
    if (!isConnected) return;
    if (opened.current)
      window.dispatchEvent(new CustomEvent("parent-child-status-refresh"));
    opened.current = true;
  }, [isConnected]);
  return null;
}
