import { proxyGet } from "~/lib/traeger/route-wrapper.server";

// Schulen mit künftigen Schichten, vor dem Ausschalten der Einsatzplanung
// (#4708).
export const GET = proxyGet("/traeger/staff-planning/future-shifts");
