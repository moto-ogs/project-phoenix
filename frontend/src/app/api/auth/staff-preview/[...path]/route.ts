import { portalRoutes } from "~/lib/contract/portals.generated";
import { catalogProxyUnder } from "~/lib/route-wrapper.server";

/*
 * The staff portal's staff-view preview's candidate list at the backend's `/auth/staff-preview/candidates` (#2352), a path of the
 * staff proxy's fixed list beside `/api`
 * (`lib/contract/catalog-outside-mounts.ts`). Next would hand
 * `/api/auth/staff-preview…` to Auth.js's `auth/[...nextauth]`, so this file hands it to the
 * staff portal's catalog proxy, which serves only the routes the contract
 * registers for the staff portal.
 * Starting and ending a preview keep their route files: they set the
 * session.
 */
const head = ["auth", "staff-preview"];
const routes = portalRoutes.tenant;

export const GET = catalogProxyUnder(head, routes, "GET");
