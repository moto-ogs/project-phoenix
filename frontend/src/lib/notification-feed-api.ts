// Client des Benachrichtigungs-Feeds je Portal: Staff-Glocke (#7148), moto
// schule (#7139), Elternportal (#7140), Träger (#7146) und Caterer (#7147).
// Jedes Portal liest seinen Feed über die eigenen Routen; die Glocke bekommt
// die Aufrufe ihres Portals über `notification-feed-portal.ts`.

import { bffJson } from "./bff-fetch";
import {
  mapNotificationFeedPage,
  type NotificationFeedPage,
} from "./notification-feed-helpers";

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

const page = (cursor?: string | null) => ({
  limit: NOTIFICATION_FEED_PAGE_SIZE,
  cursor: cursor || undefined,
});

/** Der Feed des Staff-Portals. */
export const tenantNotificationFeedApi: NotificationFeedApi = {
  fetchPage: async (cursor) =>
    mapNotificationFeedPage(
      await bffJson("tenant", "GET /api/notifications/feed/", {
        query: page(cursor),
      }),
    ),
  fetchUnreadCount: async () =>
    (await bffJson("tenant", "GET /api/notifications/feed/unread-count"))
      .unread_count,
  markRead: async (id) =>
    (
      await bffJson("tenant", "POST /api/notifications/feed/{id}/read", {
        params: { id },
      })
    ).unread_count,
  markAllRead: async () =>
    (await bffJson("tenant", "POST /api/notifications/feed/read-all"))
      .unread_count,
};

/** Der Feed von moto schule (#7139). */
export const schoolNotificationFeedApi: NotificationFeedApi = {
  fetchPage: async (cursor) =>
    mapNotificationFeedPage(
      await bffJson("school", "GET /school/notifications/feed/", {
        query: page(cursor),
      }),
    ),
  fetchUnreadCount: async () =>
    (await bffJson("school", "GET /school/notifications/feed/unread-count"))
      .unread_count,
  markRead: async (id) =>
    (
      await bffJson("school", "POST /school/notifications/feed/{id}/read", {
        params: { id },
      })
    ).unread_count,
  markAllRead: async () =>
    (await bffJson("school", "POST /school/notifications/feed/read-all"))
      .unread_count,
};

/** Der Feed des Träger-Portals über alle Schulen des Trägers (#7146). */
export const traegerNotificationFeedApi: NotificationFeedApi = {
  fetchPage: async (cursor) =>
    mapNotificationFeedPage(
      await bffJson("org", "GET /traeger/notifications/feed/", {
        query: page(cursor),
      }),
    ),
  fetchUnreadCount: async () =>
    (await bffJson("org", "GET /traeger/notifications/feed/unread-count"))
      .unread_count,
  markRead: async (id) =>
    (
      await bffJson("org", "POST /traeger/notifications/feed/{id}/read", {
        params: { id },
      })
    ).unread_count,
  markAllRead: async () =>
    (await bffJson("org", "POST /traeger/notifications/feed/read-all"))
      .unread_count,
};

/** Der Feed des Caterer-Portals (#7147). */
export const catererNotificationFeedApi: NotificationFeedApi = {
  fetchPage: async (cursor) =>
    mapNotificationFeedPage(
      await bffJson("caterer", "GET /caterer/notifications/feed/", {
        query: page(cursor),
      }),
    ),
  fetchUnreadCount: async () =>
    (await bffJson("caterer", "GET /caterer/notifications/feed/unread-count"))
      .unread_count,
  markRead: async (id) =>
    (
      await bffJson("caterer", "POST /caterer/notifications/feed/{id}/read", {
        params: { id },
      })
    ).unread_count,
  markAllRead: async () =>
    (await bffJson("caterer", "POST /caterer/notifications/feed/read-all"))
      .unread_count,
};

/** Der Feed des Elternkontos über alle Schulen der Familie (#7140). */
export const parentNotificationFeedApi: NotificationFeedApi = {
  fetchPage: async (cursor) =>
    mapNotificationFeedPage(
      await bffJson("parent", "GET /parent/me/notifications/feed/", {
        query: page(cursor),
      }),
    ),
  fetchUnreadCount: async () =>
    (await bffJson("parent", "GET /parent/me/notifications/feed/unread-count"))
      .unread_count,
  markRead: async (id) =>
    (
      await bffJson("parent", "POST /parent/me/notifications/feed/{id}/read", {
        params: { id },
      })
    ).unread_count,
  markAllRead: async () =>
    (await bffJson("parent", "POST /parent/me/notifications/feed/read-all"))
      .unread_count,
};
