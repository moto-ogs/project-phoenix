// Feed calls of every portal for bell tests: each portal's api object hands
// its route base to shared spies, so a test still sees which portal's feed a
// bell reads.
//
//   const api = vi.hoisted(() => ({ fetchNotificationFeed: vi.fn(), ... }));
//   vi.mock("~/lib/notification-feed-api", async (importOriginal) => ({
//     ...(await importOriginal<typeof import("~/lib/notification-feed-api")>()),
//     ...portalFeedApis(api),
//   }));
import type { NotificationFeedApi } from "~/lib/notification-feed-api";
import type { NotificationFeedPage } from "~/lib/notification-feed-helpers";

interface FeedSpies {
  fetchNotificationFeed: (
    base: string,
    cursor?: string | null,
  ) => Promise<NotificationFeedPage>;
  fetchNotificationFeedUnreadCount: (base: string) => Promise<number>;
  markNotificationFeedEntryRead: (base: string, id: string) => Promise<number>;
  markAllNotificationFeedRead: (base: string) => Promise<number>;
}

function viaBase(spies: FeedSpies, base: string): NotificationFeedApi {
  return {
    fetchPage: (cursor) =>
      cursor
        ? spies.fetchNotificationFeed(base, cursor)
        : spies.fetchNotificationFeed(base),
    fetchUnreadCount: () => spies.fetchNotificationFeedUnreadCount(base),
    markRead: (id) => spies.markNotificationFeedEntryRead(base, id),
    markAllRead: () => spies.markAllNotificationFeedRead(base),
  };
}

export function portalFeedApis(spies: FeedSpies) {
  return {
    tenantNotificationFeedApi: viaBase(spies, "/api/notifications/feed"),
    schoolNotificationFeedApi: viaBase(spies, "/api/school/notifications/feed"),
    traegerNotificationFeedApi: viaBase(
      spies,
      "/api/traeger/notifications/feed",
    ),
    catererNotificationFeedApi: viaBase(
      spies,
      "/api/caterer/notifications/feed",
    ),
  };
}
