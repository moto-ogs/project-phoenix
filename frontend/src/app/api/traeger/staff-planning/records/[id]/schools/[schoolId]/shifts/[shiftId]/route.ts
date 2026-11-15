import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";
import { proxyDelete } from "~/lib/traeger/route-wrapper.server";

// Eine Schicht einer Akte an einer Schule löschen (#4708).
export const DELETE = proxyDelete(
  (params) =>
    `/traeger/staff-planning/records/${requirePathSegmentParam(params)}/schools/${requirePathSegmentParam(params, "schoolId")}/shifts/${requirePathSegmentParam(params, "shiftId")}`,
);
