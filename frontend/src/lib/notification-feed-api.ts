// Client des Benachrichtigungs-Feeds (#7148, #7140). Die Routen unter
// /api/notifications/feed (Staff-Portal) und /api/parent/me/notifications/feed
// (Elternportal) reichen an das Backend weiter; der Wrapper antwortet mit
// { success, message, data }. Beide Portale lesen dieselbe Form.

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

/** Die Aufrufe eines Feeds; jedes Portal hat seinen eigenen. */
export interface NotificationFeedApi {
  fetchPage(cursor?: string | null): Promise<NotificationFeedPage>;
  fetchUnreadCount(): Promise<number>;
  /** Markiert einen Eintrag als gelesen; liefert den neuen Zähler. */
  markRead(id: string): Promise<number>;
  /** Markiert alle Einträge als gelesen; liefert den neuen Zähler. */
  markAllRead(): Promise<number>;
}

function notificationFeedApi(basePath: string): NotificationFeedApi {
  return {
    async fetchPage(cursor) {
      const query = new URLSearchParams({
        limit: String(NOTIFICATION_FEED_PAGE_SIZE),
      });
      if (cursor) query.set("cursor", cursor);
      const response = await authFetch<ProxyResponse<NotificationFeedPageWire>>(
        `${basePath}?${query.toString()}`,
      );
      return mapNotificationFeedPage(response.data);
    },
    async fetchUnreadCount() {
      const response = await authFetch<ProxyResponse<UnreadCountWire>>(
        `${basePath}/unread-count`,
      );
      return response.data.unread_count;
    },
    async markRead(id) {
      const response = await authFetch<ProxyResponse<UnreadCountWire>>(
        `${basePath}/${encodeURIComponent(id)}/read`,
        { method: "POST" },
      );
      return response.data.unread_count;
    },
    async markAllRead() {
      const response = await authFetch<ProxyResponse<UnreadCountWire>>(
        `${basePath}/read-all`,
        { method: "POST" },
      );
      return response.data.unread_count;
    },
  };
}

/** Der Feed des Kontos in der Schule der Sitzung (Staff-Portal, #7148). */
const staffNotificationFeedApi = notificationFeedApi("/api/notifications/feed");

/** Der Feed des Elternkontos über alle Schulen der Familie (#7140). */
export const parentNotificationFeedApi = notificationFeedApi(
  "/api/parent/me/notifications/feed",
);

export const fetchNotificationFeed = staffNotificationFeedApi.fetchPage;
export const fetchNotificationFeedUnreadCount =
  staffNotificationFeedApi.fetchUnreadCount;
export const markNotificationFeedEntryRead = staffNotificationFeedApi.markRead;
export const markAllNotificationFeedRead = staffNotificationFeedApi.markAllRead;
