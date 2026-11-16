import { proxyGet } from "~/lib/school/route-wrapper.server";

/**
 * GET /api/school/notifications/feed — eine Seite der Hinweise der Lehrkraft
 * in moto schule (#7139), neueste Aktualisierung zuerst. Nur Seitengröße und
 * der undurchsichtige Cursor gehen weiter.
 */
export const GET = proxyGet("/school/notifications/feed", {
  forwardQuery: ["limit", "cursor"],
});
