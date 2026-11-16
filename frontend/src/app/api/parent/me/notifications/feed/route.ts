import { proxyGet } from "~/lib/parent/route-wrapper.server";

/**
 * GET /api/parent/me/notifications/feed — eine Seite der Hinweise des Kontos
 * über alle Schulen der Familie (#7140), neueste Aktualisierung zuerst. Nur
 * Seitengröße und der undurchsichtige Cursor gehen weiter.
 */
// The backend collection route is registered with this trailing slash.
export const GET = proxyGet("/parent/me/notifications/feed/", {
  forwardQuery: ["limit", "cursor"],
});
