import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";
import { proxyPost } from "~/lib/traeger/route-wrapper.server";

// Einen Abschluss des Trägers in jeder Schule wieder öffnen (#4711).
export const POST = proxyPost(
  (params) =>
    `/traeger/staff-records/${requirePathSegmentParam(params)}/time-account/reopen`,
);
