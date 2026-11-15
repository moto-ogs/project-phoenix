import { proxyGet } from "~/lib/traeger/route-wrapper.server";

// Standortvergleich: Kennzahlen der gewählten Schulen nebeneinander (#4715).
export const GET = proxyGet("/traeger/schools/comparison");
