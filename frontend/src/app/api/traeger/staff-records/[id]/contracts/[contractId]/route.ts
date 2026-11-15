import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";
import { proxyDelete, proxyPut } from "~/lib/traeger/route-wrapper.server";

// Art und Ende eines Arbeitsvertrags ändern oder ihn löschen (#4706).
const contractPath = (params: Record<string, unknown>) =>
  `/traeger/staff-records/${requirePathSegmentParam(params)}/contracts/${requirePathSegmentParam(params, "contractId")}`;

export const PUT = proxyPut(contractPath);

export const DELETE = proxyDelete(contractPath);
