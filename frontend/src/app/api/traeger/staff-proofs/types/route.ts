import { proxyGet, proxyPost } from "~/lib/traeger/route-wrapper.server";

// Nachweisarten des Trägers (#4707): lesen und anlegen.
export const GET = proxyGet("/traeger/staff-proofs/types");

export const POST = proxyPost("/traeger/staff-proofs/types");
