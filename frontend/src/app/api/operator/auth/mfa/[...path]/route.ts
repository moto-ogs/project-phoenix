import { portalRoutes } from "~/lib/contract/portals.generated";
import { catalogProxyUnder } from "~/lib/operator/route-wrapper.server";

/*
 * The operator's remembered devices.
 * Next would hand `/api/operator/auth/…` to Auth.js's `auth/[...nextauth]`, so
 * this file hands it to the portal's catalog proxy, which serves only the
 * routes the contract registers for the portal (#2352). The steps of the
 * sign-in keep their own files beside this one.
 */
const head = ["auth", "mfa"];
const routes = portalRoutes.platform;

export const GET = catalogProxyUnder(head, routes, "GET");
export const DELETE = catalogProxyUnder(head, routes, "DELETE");
