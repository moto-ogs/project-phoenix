import { schoolPortal } from "~/server/auth/school";
import {
  handOffUnder,
  makeCatalogProxy,
  type CatalogMethod,
  type CatalogRoute,
  type HandOffHead,
} from "../contract/catalog-proxy.server";
import { CATALOG_OUTSIDE_MOUNTS } from "../contract/catalog-outside-mounts";
import { makePortalHandlers } from "../portal-handlers.server";

/** moto schule's route handlers (#2207), on the school session only. */
export const school = makePortalHandlers(schoolPortal);

/**
 * moto schule's proxy: forwards `/api/school/…` to the backend's `/school/…`
 * for the routes the contract registers for this portal.
 */
export const catalogProxy = (
  routes: readonly CatalogRoute[],
  method: CatalogMethod,
  publicRoutes: readonly CatalogRoute[] = [],
) =>
  makeCatalogProxy(
    school,
    "/school",
    routes,
    method,
    CATALOG_OUTSIDE_MOUNTS.school,
    { routes: publicRoutes },
  );

/**
 * The moto schule's proxy for a route file below its BFF prefix that Next would
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
