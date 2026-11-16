import { proxyGet } from "~/lib/school/route-wrapper.server";

// Serienbriefe (#4813): die Platzhalter eines Elternbriefs in moto schule.
export const GET = proxyGet("/school/parent-letters/letter-placeholders");
