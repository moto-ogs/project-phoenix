import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";
import { proxyGet } from "~/lib/traeger/route-wrapper.server";

// Das Stundenkonto einer Akte über alle Schulen in einem Monat (#4711).
export const GET = proxyGet(
  (params) =>
    `/traeger/staff-records/${requirePathSegmentParam(params)}/time-account`,
  { forwardQuery: ["year", "month"] },
);
