import { proxyGet } from "~/lib/traeger/route-wrapper.server";
import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";

// Die Kinder einer Schule mit Namen, nur mit „Verträge verwalten“ (#4713).
export const GET = proxyGet(
  (params) =>
    `/traeger/schools/${requirePathSegmentParam(params)}/utilization/children`,
);
