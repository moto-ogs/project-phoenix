import { portalRoutes } from "~/lib/contract/portals.generated";
import { catalogProxyUnder } from "~/lib/route-wrapper.server";

/*
 * The staff portal's account provisioning at the backend's `/auth/register` (#2352), a path of the
 * staff proxy's fixed list beside `/api`
 * (`lib/contract/catalog-outside-mounts.ts`). Next would hand
 * `/api/auth/register…` to Auth.js's `auth/[...nextauth]`, so this file hands it to the
 * staff portal's catalog proxy, which serves only the routes the contract
 * registers for the staff portal.
 */
const head = ["auth", "register"];
const routes = portalRoutes.tenant;

export const POST = catalogProxyUnder(head, routes, "POST");
