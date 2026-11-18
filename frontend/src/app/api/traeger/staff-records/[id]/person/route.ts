import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";
import { proxyPut } from "~/lib/traeger/route-wrapper.server";

// Name und Geburtstag einer Akte korrigieren (#7379).
export const PUT = proxyPut(
  (params) =>
    `/traeger/staff-records/${requirePathSegmentParam(params)}/person`,
);
