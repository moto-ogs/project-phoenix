import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";
import { proxyPut } from "~/lib/traeger/route-wrapper.server";

// Eine Abwesenheitsart des Trägers ändern (#4710); moto trägt sie in jede
// Schule weiter.
export const PUT = proxyPut(
  (params) => `/traeger/absence-types/${requirePathSegmentParam(params)}`,
);
