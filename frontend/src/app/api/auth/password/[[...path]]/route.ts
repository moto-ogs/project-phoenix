import { portalRoutes } from "~/lib/contract/portals.generated";
import { catalogProxyUnder } from "~/lib/route-wrapper.server";

/*
 * The staff portal's password change at the backend's `/auth/password`
 * (#2352), a path of the staff proxy's fixed list beside `/api`
 * (`lib/contract/catalog-outside-mounts.ts`). Next would hand
 * `/api/auth/password` to Auth.js's `auth/[...nextauth]`, so this optional
 * catch-all hands it to the staff portal's catalog proxy, which serves only
 * the routes the contract registers for the staff portal.
 */
const head = ["auth", "password"];

export const POST = catalogProxyUnder(head, portalRoutes.tenant, "POST");
