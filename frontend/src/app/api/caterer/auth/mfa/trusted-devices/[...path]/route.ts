import { portalRoutes } from "~/lib/contract/portals.generated";
import { catalogProxyUnder } from "~/lib/caterer/route-wrapper.server";

/*
 * The caterer's own remembered devices at the backend's
 * `/caterer/auth/mfa/trusted-devices/…` (#2352). Next would hand
 * `/api/caterer/auth/…` to Auth.js's `caterer/auth/[...nextauth]`, so this
 * file hands it to the caterer portal's catalog proxy, which serves only the
 * routes the contract registers for the caterer portal. The list keeps its
 * temporary file beside this one.
 */
const head = ["auth", "mfa", "trusted-devices"];
const routes = portalRoutes.caterer;

export const DELETE = catalogProxyUnder(head, routes, "DELETE");
