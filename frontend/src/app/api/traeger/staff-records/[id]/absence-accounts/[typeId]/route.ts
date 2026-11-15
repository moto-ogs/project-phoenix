import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";
import { proxyPut } from "~/lib/traeger/route-wrapper.server";

// Den Anspruch einer Person für eine Art und ein Jahr setzen (#4710).
export const PUT = proxyPut(
  (params) =>
    `/traeger/staff-records/${requirePathSegmentParam(params)}/absence-accounts/${requirePathSegmentParam(params, "typeId")}`,
);
