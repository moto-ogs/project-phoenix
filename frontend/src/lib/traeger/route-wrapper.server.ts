import { traegerPortal } from "~/server/auth/traeger";
import {
  handOffUnder,
  makeCatalogProxy,
  type CatalogMethod,
  type CatalogRoute,
  type HandOffHead,
} from "../contract/catalog-proxy.server";
import { makePortalHandlers } from "../portal-handlers.server";

/**
 * The Träger portal's route handlers ("moto träger", #4649), on the Träger
 * session only, so a Träger route never forwards a tenant, parent or school
 * token.
 */
export const traeger = makePortalHandlers(traegerPortal);

/**
 * The Träger portal's proxy: forwards `/api/traeger/…` to the backend's `/traeger/…`
 * for the routes the contract registers for this portal, and the public
 * routes under that mount without a session (`portalRoutes.public`).
 */
export const catalogProxy = (
  routes: readonly CatalogRoute[],
  method: CatalogMethod,
  publicRoutes: readonly CatalogRoute[] = [],
) =>
  makeCatalogProxy(traeger, "/traeger", routes, method, [], {
    routes: publicRoutes,
  });

/**
 * The Träger portal's proxy for a route file below its BFF prefix that Next would
 * give Auth.js's `auth/[...nextauth]`: the head goes in front of the file's
 * catch-all `path` again (#2352). `publicRoutes` are served without a
 * session, as in the catch-all.
 */
export function catalogProxyUnder(
  head: HandOffHead,
  routes: readonly CatalogRoute[],
  method: CatalogMethod,
  publicRoutes: readonly CatalogRoute[] = [],
) {
  return handOffUnder(head, catalogProxy(routes, method, publicRoutes));
}
