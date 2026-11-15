import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";
import { proxyDelete, proxyPut } from "~/lib/traeger/route-wrapper.server";

// Eine Berichtsvorlage des Trägers ändern oder löschen (#4716).
export const PUT = proxyPut(
  (params) => `/traeger/report-templates/${requirePathSegmentParam(params)}`,
);

export const DELETE = proxyDelete(
  (params) => `/traeger/report-templates/${requirePathSegmentParam(params)}`,
);
