import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";
import { proxyGet } from "~/lib/traeger/route-wrapper.server";

// Die Kontingente einer Akte über alle Schulen in einem Jahr (#4710).
export const GET = proxyGet(
  (params) =>
    `/traeger/staff-records/${requirePathSegmentParam(params)}/absence-accounts`,
  { forwardQuery: ["year"] },
);
