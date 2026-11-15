import { proxyGet, proxyPost } from "~/lib/traeger/route-wrapper.server";

// Berichtsvorlagen des Trägers (#4716): die Liste und das Anlegen.
export const GET = proxyGet("/traeger/report-templates/");

export const POST = proxyPost("/traeger/report-templates/");
