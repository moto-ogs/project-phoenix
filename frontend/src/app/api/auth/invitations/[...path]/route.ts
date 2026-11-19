import { portalRoutes } from "~/lib/contract/portals.generated";
import { catalogProxyUnder } from "~/lib/route-wrapper.server";

/*
 * The staff portal's invitation routes at the backend's `/auth/invitations`
 * (#2352), a path of the staff proxy's fixed list beside `/api`
 * (`lib/contract/catalog-outside-mounts.ts`). Next would hand
 * `/api/auth/invitations/…` to Auth.js's `auth/[...nextauth]`, so this file
 * hands it to the staff portal's catalog proxy instead. Only the routes the
 * contract registers for the staff portal are served; the public link
 * (`/auth/invitations/{token}`) is not among them and keeps
 * `invitations/validate`.
 */
const head = ["auth", "invitations"];
const routes = portalRoutes.tenant;

export const POST = catalogProxyUnder(head, routes, "POST");
export const DELETE = catalogProxyUnder(head, routes, "DELETE");
