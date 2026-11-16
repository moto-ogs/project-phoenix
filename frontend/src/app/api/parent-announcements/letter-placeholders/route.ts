import { proxyGet } from "~/lib/route-wrapper.server";

// Serienbriefe (#4813): die feste Liste der Platzhalter eines Elternbriefs.
export const GET = proxyGet(
  () => "/api/parent-announcements/letter-placeholders",
);
