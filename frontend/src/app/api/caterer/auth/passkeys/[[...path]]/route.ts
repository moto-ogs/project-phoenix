import { portalRoutes } from "~/lib/contract/portals.generated";
import { catalogProxyUnder } from "~/lib/caterer/route-wrapper.server";

/*
 * The caterer's own passkeys (#2352): the list on the bare path, the
 * registration and deleting one. Next would hand `/api/caterer/auth/passkeys`
 * and its children to Auth.js's `auth/[...nextauth]`, so this optional
 * catch-all hands them to the portal's catalog proxy. The passkey sign-in mints a
 * session and keeps its own files.
 */
const head = ["auth", "passkeys"];
const routes = portalRoutes.caterer;

export const GET = catalogProxyUnder(head, routes, "GET");
export const POST = catalogProxyUnder(head, routes, "POST");
export const DELETE = catalogProxyUnder(head, routes, "DELETE");
