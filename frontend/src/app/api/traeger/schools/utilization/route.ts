import { proxyGet } from "~/lib/traeger/route-wrapper.server";

// Auslastung aller Schulen des Trägers über einen Zeitraum (#4713).
export const GET = proxyGet("/traeger/schools/utilization");
