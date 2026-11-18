import { proxyGet } from "~/lib/traeger/route-wrapper.server";

// Die Pflichtangaben, die dem Träger für Verträge, Rechnungen und Bescheide
// noch fehlen (#7177).
export const GET = proxyGet("/traeger/required-details");
