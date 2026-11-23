import { portalRoutes } from "~/lib/contract/portals.generated";
import { catalogProxyUnder } from "~/lib/caterer/route-wrapper.server";

/*
 * The password reset and its confirmation (#2352). Both routes are public:
 * the proxy reads no session and sends no bearer. Next would hand this path
 * to Auth.js's `auth/[...nextauth]`, so this file hands it to the portal's
 * catalog proxy.
 */
const head = ["auth", "password-reset"];

export const POST = catalogProxyUnder(
  head,
  portalRoutes.caterer,
  "POST",
  portalRoutes.public,
);
