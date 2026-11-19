import { portalRoutes } from "~/lib/contract/portals.generated";
import { catalogProxyUnder } from "~/lib/route-wrapper.server";

/*
 * The staff portal's permission catalogue at the backend's `/auth/permissions` (#2352), a path of the
 * staff proxy's fixed list beside `/api`
 * (`lib/contract/catalog-outside-mounts.ts`). Next would hand
 * `/api/auth/permissions…` to Auth.js's `auth/[...nextauth]`, so this file hands it to the
 * staff portal's catalog proxy, which serves only the routes the contract
 * registers for the staff portal.
 * Writing permissions needs the operator's platform scope, so no write is
 * registered and those requests answer 404.
 */
const head = ["auth", "permissions"];
const routes = portalRoutes.tenant;

export const GET = catalogProxyUnder(head, routes, "GET");
