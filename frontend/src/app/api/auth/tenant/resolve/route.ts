import { portalRoutes } from "~/lib/contract/portals.generated";
import { catalogProxyUnder } from "~/lib/route-wrapper.server";

/*
 * The public tenant lookup at the backend's `/auth/tenant/resolve` (#2342):
 * the school pages and the login resolve the school before a session
 * exists. Next would hand `/api/auth/…` to Auth.js's `auth/[...nextauth]`,
 * so this file hands the path to the staff portal's catalog proxy, which
 * serves it without a session and only as the contract registers it.
 */
export const GET = catalogProxyUnder(
  ["auth", "tenant", "resolve"],
  portalRoutes.tenant,
  "GET",
  portalRoutes.public,
);
