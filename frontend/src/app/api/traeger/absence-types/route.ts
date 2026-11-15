import { proxyGet, proxyPost } from "~/lib/traeger/route-wrapper.server";

// Abwesenheitsarten des Trägers (#4710): die Liste mit der Abweichung jeder
// Schule und das Anlegen einer Art.
export const GET = proxyGet("/traeger/absence-types/");

export const POST = proxyPost("/traeger/absence-types/");
