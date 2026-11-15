import { proxyGet } from "~/lib/traeger/route-wrapper.server";

// Bericht aller Schulen des Trägers zum Stichtag, mit oder ohne Vorlage (#4716).
export const GET = proxyGet("/traeger/reports/key-date");
