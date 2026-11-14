import { proxyGet } from "~/lib/route-wrapper.server";
import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";

/**
 * GET /api/staff/{id}/traeger-proofs
 * Der Stand der Nachweise, die der Träger für die Person führt (#4707):
 * je Art nur Stand und Ablaufdatum, nie der Nachweis selbst.
 */
export const GET = proxyGet(
  (p) => `/api/staff/${requirePathSegmentParam(p)}/traeger-proofs`,
);
