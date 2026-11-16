import { proxyPost } from "~/lib/parent/route-wrapper.server";

interface UnreadCount {
  unread_count: number;
}

/** POST /api/parent/me/notifications/feed/read-all — alle Hinweise gelesen (#7140). */
export const POST = proxyPost<UnreadCount>(
  "/parent/me/notifications/feed/read-all",
);
