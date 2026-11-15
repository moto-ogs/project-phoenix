import { proxyGet } from "~/lib/route-wrapper.server";

/** GET /api/notifications/feed/unread-count — Zähler der ungelesenen Hinweise. */
export const GET = proxyGet("/api/notifications/feed/unread-count");
