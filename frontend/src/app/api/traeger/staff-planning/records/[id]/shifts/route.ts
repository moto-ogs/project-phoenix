import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";
import { proxyPost } from "~/lib/traeger/route-wrapper.server";

// Eine Schicht einer Akte an einem ihrer Einsatzorte planen (#4708).
export const POST = proxyPost(
  (params) =>
    `/traeger/staff-planning/records/${requirePathSegmentParam(params)}/shifts`,
);
