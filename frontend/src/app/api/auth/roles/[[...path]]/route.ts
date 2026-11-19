import { portalRoutes } from "~/lib/contract/portals.generated";
import { catalogProxyUnder } from "~/lib/route-wrapper.server";

/*
 * The staff portal's role administration at the backend's `/auth/roles` (#2352), a path of the
 * staff proxy's fixed list beside `/api`
 * (`lib/contract/catalog-outside-mounts.ts`). Next would hand
 * `/api/auth/roles…` to Auth.js's `auth/[...nextauth]`, so this file hands it to the
 * staff portal's catalog proxy, which serves only the routes the contract
 * registers for the staff portal.
 */
const head = ["auth", "roles"];
const routes = portalRoutes.tenant;

export const GET = catalogProxyUnder(head, routes, "GET");
export const POST = catalogProxyUnder(head, routes, "POST");
export const PUT = catalogProxyUnder(head, routes, "PUT");
export const DELETE = catalogProxyUnder(head, routes, "DELETE");
