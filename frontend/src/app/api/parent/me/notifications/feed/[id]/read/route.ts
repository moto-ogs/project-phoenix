import { proxyPost } from "~/lib/parent/route-wrapper.server";
import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";

interface UnreadCount {
  unread_count: number;
}

/**
 * POST /api/parent/me/notifications/feed/{id}/read — einen Hinweis als
 * gelesen markieren (#7140). Das Backend prüft die ID und das Konto.
 */
export const POST = proxyPost<UnreadCount>(
  (params) =>
    `/parent/me/notifications/feed/${requirePathSegmentParam(params, "id")}/read`,
);
