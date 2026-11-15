import { proxyGet } from "~/lib/route-wrapper.server";

// GET /api/work-time-models/assignments (#6921): was für jede Person über
// eine Zuordnung entscheidet (Vorlage, Soll, Träger, abgeschlossener Monat).
export const GET = proxyGet<Record<string, unknown>[]>(
  "/api/work-time-models/assignments",
);
