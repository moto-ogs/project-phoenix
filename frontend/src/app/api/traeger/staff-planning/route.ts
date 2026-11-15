import { proxyGet } from "~/lib/traeger/route-wrapper.server";

// Die Woche der Einsatzplanung über alle Einsatzorte (#4708).
export const GET = proxyGet("/traeger/staff-planning/", {
  forwardQuery: ["week"],
});
