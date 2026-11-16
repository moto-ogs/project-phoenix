import { proxyGet } from "~/lib/traeger/route-wrapper.server";

// Die Prüfung der Lohndatei des Trägers über alle Schulen (#4712).
export const GET = proxyGet("/traeger/staff-exports/payroll", {
  forwardQuery: ["year", "month", "format"],
});
