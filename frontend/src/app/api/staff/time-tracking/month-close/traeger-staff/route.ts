// Die Personen, deren Monat der Träger abschließt (#4711): ein Vertrag des
// Trägers deckt den Monat ab. Der Abschluss der Schule lässt sie aus.
import { proxyGet } from "~/lib/route-wrapper.server";

/** GET /api/staff/time-tracking/month-close/traeger-staff?year=&month= */
export const GET = proxyGet<{ staff_ids: number[] | null }>(
  "/api/staff/time-tracking/month-close/traeger-staff",
);
