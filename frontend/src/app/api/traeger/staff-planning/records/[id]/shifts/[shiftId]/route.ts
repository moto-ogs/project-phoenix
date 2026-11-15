import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";
import { proxyPut } from "~/lib/traeger/route-wrapper.server";

// Eine geplante Schicht einer Akte ändern (#4708).
export const PUT = proxyPut(
  (params) =>
    `/traeger/staff-planning/records/${requirePathSegmentParam(params)}/shifts/${requirePathSegmentParam(params, "shiftId")}`,
);
