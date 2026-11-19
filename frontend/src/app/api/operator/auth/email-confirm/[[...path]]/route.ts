import { portalRoutes } from "~/lib/contract/portals.generated";
import { catalogProxyUnder } from "~/lib/operator/route-wrapper.server";

/*
 * The confirmation of a new address from the mailed link (#2352), a public
 * route: the proxy reads no session and sends no bearer. Next would hand
 * this path to Auth.js's `auth/[...nextauth]`, so this file hands it to the
 * operator portal's catalog proxy.
 */
const head = ["auth", "email-confirm"];

export const POST = catalogProxyUnder(
  head,
  portalRoutes.platform,
  "POST",
  portalRoutes.public,
);
