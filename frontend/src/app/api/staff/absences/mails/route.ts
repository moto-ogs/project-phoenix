import { proxyGet } from "~/lib/route-wrapper.server";

/**
 * GET /api/staff/absences/mails?ids=1,2
 * Ob die Mails zu den Entscheidungen bei den Antragstellenden ankamen (#7058).
 * Backend gates on vacation:approve.
 */
export const GET = proxyGet("/api/staff/absences/mails");
