import { portalRoutes } from "~/lib/contract/portals.generated";
import { catalogProxyUnder } from "~/lib/route-wrapper.server";

/*
 * The staff portal's own remembered devices at the backend's `/auth/mfa/trusted-devices` (#2352), a path of the
 * staff proxy's fixed list beside `/api`
 * (`lib/contract/catalog-outside-mounts.ts`). Next would hand
 * `/api/auth/mfa/trusted-devices` and its children to Auth.js's
 * `auth/[...nextauth]`, so this optional catch-all hands the list and the
 * single device to the staff portal's catalog proxy, which serves only the
 * routes the contract registers for the staff portal.
 */
const head = ["auth", "mfa", "trusted-devices"];
const routes = portalRoutes.tenant;

export const GET = catalogProxyUnder(head, routes, "GET");
export const DELETE = catalogProxyUnder(head, routes, "DELETE");
