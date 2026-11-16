// POST /api/timetable/instances/[id]/reinstate — takes back the cancellation
// of a block that has not ended yet (#7151).
import { proxyPost } from "~/lib/route-wrapper.server";
import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";

export const POST = proxyPost(
  (params) =>
    `/api/timetable/instances/${requirePathSegmentParam(params)}/reinstate`,
);
