import { parentPortal } from "~/server/auth/parent";
import {
  handOffUnder,
  makeCatalogProxy,
  type CatalogMethod,
  type CatalogRoute,
  type HandOffHead,
} from "../contract/catalog-proxy.server";
import { CATALOG_OUTSIDE_MOUNTS } from "../contract/catalog-outside-mounts";
import { makePortalHandlers } from "../portal-handlers.server";

/** The parents portal's route handlers, on the parent session only. */
export const parent = makePortalHandlers(parentPortal);

export const {
  proxyFile,
  proxyUpload,
  proxyGet,
  proxyPost,
  proxyPut,
  proxyPatch,
  proxyDelete,
  jsonProxy: createParentJsonProxy,
} = parent;

/**
 * The guardians' portal proxy: forwards `/api/parent/…` to the backend's
 * `/parent/…` for the routes the contract registers for this portal.
 */
export const catalogProxy = (
  routes: readonly CatalogRoute[],
  method: CatalogMethod,
  publicRoutes: readonly CatalogRoute[] = [],
) =>
  makeCatalogProxy(
    parent,
    "/parent",
    routes,
    method,
    CATALOG_OUTSIDE_MOUNTS.parent,
    { routes: publicRoutes },
  );

/**
 * The guardians' portal proxy for a route file below its BFF prefix that Next would
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
