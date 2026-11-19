import { portalRoutes } from "~/lib/contract/portals.generated";
import { catalogProxyUnder, isStringParam } from "~/lib/route-wrapper.server";

/*
 * The staff portal's administration of one account at the backend's
 * `/auth/accounts/{accountId}/…` (#2352): its roles, its second factor and
 * its caregiver capability, a path of the staff proxy's fixed list beside
 * `/api` (`lib/contract/catalog-outside-mounts.ts`). Next would hand
 * `/api/auth/accounts/…` to Auth.js's `auth/[...nextauth]`, so this file
 * hands it to the staff portal's catalog proxy, which serves only the routes
 * the contract registers for the staff portal. It sits below
 * `[accountId]` because the second factor's state keeps its temporary file
 * there.
 */
const head = (params: Record<string, string | string[] | undefined>) =>
  isStringParam(params.accountId)
    ? ["auth", "accounts", params.accountId]
    : null;
const routes = portalRoutes.tenant;

export const GET = catalogProxyUnder(head, routes, "GET");
export const POST = catalogProxyUnder(head, routes, "POST");
export const PUT = catalogProxyUnder(head, routes, "PUT");
export const DELETE = catalogProxyUnder(head, routes, "DELETE");
