import { proxyGet } from "~/lib/route-wrapper.server";

/**
 * GET /api/time-tracking/absences/mails
 * Ob die Leitung die eigenen offenen Anträge per Mail bekam (#7058).
 */
export const GET = proxyGet("/api/time-tracking/absences/mails");
