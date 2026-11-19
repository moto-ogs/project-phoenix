import { portalRoutes } from "~/lib/contract/portals.generated";
import { catalogProxyUnder } from "~/lib/caterer/route-wrapper.server";

/*
 * The caterer's own passkeys (#2352): deleting one here, and the list and the
 * registration once their temporary files beside this one are gone. Next
 * would hand `/api/caterer/auth/…` to Auth.js's `auth/[...nextauth]`, so this
 * file hands it to the portal's catalog proxy. The passkey sign-in mints a
 * session and keeps its own files.
 */
const head = ["auth", "passkeys"];
const routes = portalRoutes.caterer;

export const GET = catalogProxyUnder(head, routes, "GET");
export const POST = catalogProxyUnder(head, routes, "POST");
export const DELETE = catalogProxyUnder(head, routes, "DELETE");
