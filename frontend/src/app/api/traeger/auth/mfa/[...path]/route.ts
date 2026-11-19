import { portalRoutes } from "~/lib/contract/portals.generated";
import { catalogProxyUnder } from "~/lib/traeger/route-wrapper.server";

/*
 * The member's remembered devices and the code step in the running session
 * (#7068).
 * Next would hand `/api/traeger/auth/…` to Auth.js's `auth/[...nextauth]`, so
 * this file hands it to the portal's catalog proxy, which serves only the
 * routes the contract registers for the portal (#2352). The steps of the
 * sign-in keep their own files beside this one.
 */
const head = ["auth", "mfa"];
const routes = portalRoutes.org;

export const GET = catalogProxyUnder(head, routes, "GET");
export const POST = catalogProxyUnder(head, routes, "POST");
export const DELETE = catalogProxyUnder(head, routes, "DELETE");
