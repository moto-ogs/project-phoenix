import { proxyGet } from "~/lib/traeger/route-wrapper.server";

// Tagesmeldung der Schulen des Trägers in Mecklenburg-Vorpommern (#4717),
// mit `from` und `to`; nur mit dem Recht „Berichte lesen“.
export const GET = proxyGet("/traeger/schools/daily-attendance");
