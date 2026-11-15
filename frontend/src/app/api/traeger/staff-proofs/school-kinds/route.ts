import { proxyGet, proxyPut } from "~/lib/traeger/route-wrapper.server";

// Die Nachweisarten der Schulen und ihre Zuordnung zu den Arten des Trägers
// (#4707, Entscheidung E4).
export const GET = proxyGet("/traeger/staff-proofs/school-kinds");

export const PUT = proxyPut("/traeger/staff-proofs/school-kinds");
