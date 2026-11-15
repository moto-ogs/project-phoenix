import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";
import { proxyPost } from "~/lib/traeger/route-wrapper.server";

// Das Ferien-Soll für eine oder mehrere Wochen eintragen (#4706).
export const POST = proxyPost(
  (params) =>
    `/traeger/staff-records/${requirePathSegmentParam(params)}/contracts/${requirePathSegmentParam(params, "contractId")}/holiday-weeks`,
);
