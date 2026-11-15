import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";
import { proxyDelete } from "~/lib/traeger/route-wrapper.server";

// Eine Ferienwoche an einem Einsatzort löschen (#4706).
export const DELETE = proxyDelete(
  (params) =>
    `/traeger/staff-records/${requirePathSegmentParam(params)}/contracts/${requirePathSegmentParam(params, "contractId")}/holiday-weeks/${requirePathSegmentParam(params, "schoolId")}/${requirePathSegmentParam(params, "weekStart")}`,
);
