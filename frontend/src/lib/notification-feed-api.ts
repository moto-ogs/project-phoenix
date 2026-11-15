// Client des Benachrichtigungs-Feeds (#7148). Die Routen unter
// /api/notifications/feed (Staff-Portal) und /api/school/notifications/feed
// (moto schule, #7139) reichen an das Backend weiter; der Wrapper antwortet
// mit { success, message, data }. `apiBase` wählt das Portal.

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
const NOTIFICATION_FEED_PAGE_SIZE = 20;

export { NOTIFICATION_FEED_REFRESH_EVENT } from "./notification-events";

const STAFF_FEED_API = "/api/notifications/feed";

export async function fetchNotificationFeed(
  cursor?: string | null,
  apiBase: string = STAFF_FEED_API,
): Promise<NotificationFeedPage> {
  const query = new URLSearchParams({
    limit: String(NOTIFICATION_FEED_PAGE_SIZE),
  });
  if (cursor) query.set("cursor", cursor);
  const response = await authFetch<ProxyResponse<NotificationFeedPageWire>>(
    `${apiBase}?${query.toString()}`,
  );
  return mapNotificationFeedPage(response.data);
}

export async function fetchNotificationFeedUnreadCount(
  apiBase: string = STAFF_FEED_API,
): Promise<number> {
  const response = await authFetch<ProxyResponse<UnreadCountWire>>(
    `${apiBase}/unread-count`,
  );
  return response.data.unread_count;
}

/** Markiert einen Eintrag als gelesen; liefert den neuen Zähler. */
export async function markNotificationFeedEntryRead(
  id: string,
  apiBase: string = STAFF_FEED_API,
): Promise<number> {
  const response = await authFetch<ProxyResponse<UnreadCountWire>>(
    `${apiBase}/${encodeURIComponent(id)}/read`,
    { method: "POST" },
  );
  return response.data.unread_count;
}

/** Markiert alle Einträge als gelesen; liefert den neuen Zähler. */
export async function markAllNotificationFeedRead(
  apiBase: string = STAFF_FEED_API,
): Promise<number> {
  const response = await authFetch<ProxyResponse<UnreadCountWire>>(
    `${apiBase}/read-all`,
    { method: "POST" },
  );
  return response.data.unread_count;
}
