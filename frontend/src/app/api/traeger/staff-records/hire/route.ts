import { proxyPost } from "~/lib/traeger/route-wrapper.server";

// „Person einstellen“ (#7206): Akte, Arbeitsvertrag und die Beschäftigung
// an jedem Einsatzort in einem Schritt.
export const POST = proxyPost("/traeger/staff-records/hire");
