import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";
import { proxyDelete } from "~/lib/traeger/route-wrapper.server";

// Eine Blockung einer Schule aufheben (#4709).
export const DELETE = proxyDelete(
  (params) => `/traeger/staff-pool/blocks/${requirePathSegmentParam(params)}`,
);
