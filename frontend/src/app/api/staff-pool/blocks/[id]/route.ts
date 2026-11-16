import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";
import { proxyDelete } from "~/lib/route-wrapper.server";

// Eine eigene Blockung aufheben (#4709).
export const DELETE = proxyDelete(
  (params) => `/api/staff-pool/blocks/${requirePathSegmentParam(params)}`,
);
