import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";
import { proxyDelete, proxyPut } from "~/lib/traeger/route-wrapper.server";

// Den Nachweis einer Art an einer Akte eintragen, erneuern oder entfernen
// (#4707).
const path = (params: Record<string, unknown>) =>
  `/traeger/staff-proofs/records/${requirePathSegmentParam(params)}/${requirePathSegmentParam(params, "typeId")}`;

export const PUT = proxyPut(path);

export const DELETE = proxyDelete(path);
