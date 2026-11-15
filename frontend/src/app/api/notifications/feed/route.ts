import { proxyGet } from "~/lib/route-wrapper.server";

/**
 * GET /api/notifications/feed — eine Seite der Hinweise des Kontos in dieser
 * Schule (#7148), neueste Aktualisierung zuerst. Nur Seitengröße und der
 * undurchsichtige Cursor gehen weiter.
 */
export const GET = proxyGet("/api/notifications/feed", {
  forwardQuery: ["limit", "cursor"],
});
