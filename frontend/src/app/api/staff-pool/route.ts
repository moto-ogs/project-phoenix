import { proxyGet } from "~/lib/route-wrapper.server";

// Die Springer aus dem Vertretungspool des Trägers, eine Woche (#4709).
export const GET = proxyGet("/api/staff-pool/", { forwardQuery: ["week"] });
