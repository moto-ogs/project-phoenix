import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";
import { proxyPut } from "~/lib/traeger/route-wrapper.server";

// Die Nummer festlegen, die die nächste Rechnung einer Leistung bekommt
// (#7358).
export const PUT = proxyPut(
  (params) =>
    `/traeger/number-ranges/${requirePathSegmentParam(params, "service")}/start`,
);
