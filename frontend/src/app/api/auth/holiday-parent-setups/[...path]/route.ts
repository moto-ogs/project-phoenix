import { portalRoutes } from "~/lib/contract/portals.generated";
import { catalogProxyUnder } from "~/lib/route-wrapper.server";

/*
 * Setting up the parent account from the holiday registration's mail
 * (#6673, ADR 0216) at the backend's `/auth/holiday-parent-setups/{token}`
 * (#2352): no session, the link is the permission. Next would hand
 * `/api/auth/…` to Auth.js's `auth/[...nextauth]`, so this file hands the
 * path to the staff portal's catalog proxy, which serves it without a
 * session and only as the contract registers it.
 */
const head = ["auth", "holiday-parent-setups"];
const routes = portalRoutes.tenant;
const publicRoutes = portalRoutes.public;

export const GET = catalogProxyUnder(head, routes, "GET", publicRoutes);
export const POST = catalogProxyUnder(head, routes, "POST", publicRoutes);
