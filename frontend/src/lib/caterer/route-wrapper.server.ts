import { catererPortal } from "~/server/auth/caterer";
import {
  handOffUnder,
  makeCatalogProxy,
  type CatalogMethod,
  type CatalogRoute,
  type HandOffHead,
} from "../contract/catalog-proxy.server";
import { CATALOG_OUTSIDE_MOUNTS } from "../contract/catalog-outside-mounts";
import { makePortalHandlers } from "../portal-handlers.server";

/** The caterer portal's route handlers (ADR 0077), on the caterer session. */
export const caterer = makePortalHandlers(catererPortal);

/**
 * The caterer portal's proxy: forwards `/api/caterer/…` to the backend's `/caterer/…`
 * for the routes the contract registers for this portal, and the public
 * routes under that mount without a session (`portalRoutes.public`).
 */
export const catalogProxy = (
  routes: readonly CatalogRoute[],
  method: CatalogMethod,
  publicRoutes: readonly CatalogRoute[] = [],
) =>
  makeCatalogProxy(
    caterer,
    "/caterer",
    routes,
    method,
    CATALOG_OUTSIDE_MOUNTS.caterer,
    {
      routes: publicRoutes,
    },
  );

/**
 * The caterer portal's proxy for a route file below `/api/caterer/<head…>`
 * that Next would give Auth.js's `caterer/auth/[...nextauth]`: the head goes
 * in front of the file's catch-all `path` again (#2352).
 */
export function catalogProxyUnder(
  head: HandOffHead,
  routes: readonly CatalogRoute[],
  method: CatalogMethod,
  publicRoutes: readonly CatalogRoute[] = [],
) {
  return handOffUnder(head, catalogProxy(routes, method, publicRoutes));
}
