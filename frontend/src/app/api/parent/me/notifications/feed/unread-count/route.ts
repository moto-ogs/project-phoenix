import { proxyGet } from "~/lib/parent/route-wrapper.server";

interface UnreadCount {
  unread_count: number;
}

/** GET /api/parent/me/notifications/feed/unread-count — Zähler der Glocke (#7140). */
export const GET = proxyGet<UnreadCount>(
  "/parent/me/notifications/feed/unread-count",
);
