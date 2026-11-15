import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";
import { proxyPost } from "~/lib/traeger/route-wrapper.server";

// Den Monat einer Akte in jeder Schule abschließen, die der Vertrag des
// Trägers abdeckt (#4711).
export const POST = proxyPost(
  (params) =>
    `/traeger/staff-records/${requirePathSegmentParam(params)}/time-account/close`,
);
