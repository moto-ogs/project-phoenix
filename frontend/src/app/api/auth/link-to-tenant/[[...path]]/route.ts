import { portalRoutes } from "~/lib/contract/portals.generated";
import { catalogProxyUnder } from "~/lib/route-wrapper.server";

/*
 * The staff portal's link of an existing account to the school at the backend's `/auth/link-to-tenant` (#2352), a path of the
 * staff proxy's fixed list beside `/api`
 * (`lib/contract/catalog-outside-mounts.ts`). Next would hand
 * `/api/auth/link-to-tenant…` to Auth.js's `auth/[...nextauth]`, so this file hands it to the
 * staff portal's catalog proxy, which serves only the routes the contract
 * registers for the staff portal.
 */
const head = ["auth", "link-to-tenant"];
const routes = portalRoutes.tenant;

export const POST = catalogProxyUnder(head, routes, "POST");
