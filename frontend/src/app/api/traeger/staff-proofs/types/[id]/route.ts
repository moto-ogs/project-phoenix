import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";
import { proxyPut } from "~/lib/traeger/route-wrapper.server";

// Eine Nachweisart ändern oder archivieren (#4707).
export const PUT = proxyPut(
  (params) => `/traeger/staff-proofs/types/${requirePathSegmentParam(params)}`,
);
