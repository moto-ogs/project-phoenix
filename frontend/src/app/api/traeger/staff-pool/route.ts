import { proxyGet } from "~/lib/traeger/route-wrapper.server";

// Der Vertretungspool des Trägers mit allen Blockungen einer Woche (#4709).
export const GET = proxyGet("/traeger/staff-pool/", {
  forwardQuery: ["week"],
});
