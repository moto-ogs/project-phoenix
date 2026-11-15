import { proxyGet } from "~/lib/traeger/route-wrapper.server";

// Nachweise am Personalstamm (#4707): die Ablaufliste über alle Akten.
export const GET = proxyGet("/traeger/staff-proofs/");
