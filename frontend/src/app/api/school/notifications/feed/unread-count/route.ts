import { proxyGet } from "~/lib/school/route-wrapper.server";

/** GET /api/school/notifications/feed/unread-count — Zähler der Glocke (#7139). */
export const GET = proxyGet("/school/notifications/feed/unread-count");
