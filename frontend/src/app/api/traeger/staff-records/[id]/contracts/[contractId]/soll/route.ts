import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";
import { proxyPost } from "~/lib/traeger/route-wrapper.server";

// Ein neues Soll ab einem Tag eintragen (#4706).
export const POST = proxyPost(
  (params) =>
    `/traeger/staff-records/${requirePathSegmentParam(params)}/contracts/${requirePathSegmentParam(params, "contractId")}/soll`,
);
