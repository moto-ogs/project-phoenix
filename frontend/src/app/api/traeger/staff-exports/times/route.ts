import { proxyGet } from "~/lib/traeger/route-wrapper.server";

// Die Prüfung des Zeitexports des Trägers über alle Schulen (#4712).
export const GET = proxyGet("/traeger/staff-exports/times", {
  forwardQuery: ["year", "month"],
});
