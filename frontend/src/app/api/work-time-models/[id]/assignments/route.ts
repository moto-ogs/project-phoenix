import { proxyPost } from "~/lib/route-wrapper.server";
import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";

// POST /api/work-time-models/{id}/assignments (#6921): ordnet die Vorlage
// mehreren Personen auf einmal zu.
export const POST = proxyPost(
  (params) =>
    `/api/work-time-models/${requirePathSegmentParam(params)}/assignments`,
);
