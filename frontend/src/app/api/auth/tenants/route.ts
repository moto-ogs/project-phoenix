import { portalRoutes } from "~/lib/contract/portals.generated";
import { catalogProxyUnder } from "~/lib/route-wrapper.server";

/*
 * The public school list at the backend's `/auth/tenants` (#2352): the
 * school picker reads it without a session. Next would hand `/api/auth/…` to
 * Auth.js's `auth/[...nextauth]`, so this file hands the path to the staff
 * portal's catalog proxy, which serves it without a session.
 */
export const GET = catalogProxyUnder(
  ["auth", "tenants"],
  portalRoutes.tenant,
  "GET",
  portalRoutes.public,
);
