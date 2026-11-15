// Client des Benachrichtigungs-Feeds im Staff-Portal (#7148). Die Routen
// unter /api/notifications/feed reichen an das Backend weiter; der Wrapper
// antwortet mit { success, message, data }.

import { authFetch } from "./api-helpers";
import {
  mapNotificationFeedPage,
  type NotificationFeedPage,
  type NotificationFeedPageWire,
} from "./notification-feed-helpers";

interface ProxyResponse<T> {
  success: boolean;
  data: T;
}

interface UnreadCountWire {
  unread_count: number;
}

/** Einträge je Seite; die Glocke lädt beim Scrollen die nächste. */
export const NOTIFICATION_FEED_PAGE_SIZE = 20;

export { NOTIFICATION_FEED_REFRESH_EVENT } from "./notification-events";

export async function fetchNotificationFeed(
  cursor?: string | null,
): Promise<NotificationFeedPage> {
  const query = new URLSearchParams({
    limit: String(NOTIFICATION_FEED_PAGE_SIZE),
  });
  if (cursor) query.set("cursor", cursor);
  const response = await authFetch<ProxyResponse<NotificationFeedPageWire>>(
    `/api/notifications/feed?${query.toString()}`,
  );
  return mapNotificationFeedPage(response.data);
}

export async function fetchNotificationFeedUnreadCount(): Promise<number> {
  const response = await authFetch<ProxyResponse<UnreadCountWire>>(
    "/api/notifications/feed/unread-count",
  );
  return response.data.unread_count;
}

/** Markiert einen Eintrag als gelesen; liefert den neuen Zähler. */
export async function markNotificationFeedEntryRead(
  id: string,
): Promise<number> {
  const response = await authFetch<ProxyResponse<UnreadCountWire>>(
    `/api/notifications/feed/${encodeURIComponent(id)}/read`,
    { method: "POST" },
  );
  return response.data.unread_count;
}

/** Markiert alle Einträge als gelesen; liefert den neuen Zähler. */
export async function markAllNotificationFeedRead(): Promise<number> {
  const response = await authFetch<ProxyResponse<UnreadCountWire>>(
    "/api/notifications/feed/read-all",
    { method: "POST" },
  );
  return response.data.unread_count;
}
