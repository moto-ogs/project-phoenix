import { traegerPortal } from "~/server/auth/traeger";
import {
  makeCatalogProxy,
  type CatalogMethod,
  type CatalogRoute,
} from "../contract/catalog-proxy.server";
import { makePortalHandlers } from "../portal-handlers.server";

/**
 * The Träger portal's route handlers ("moto träger", #4649), on the Träger
 * session only, so a Träger route never forwards a tenant, parent or school
 * token.
 */
export const traeger = makePortalHandlers(traegerPortal);

export const { proxyGet, proxyPost, proxyPut, proxyDelete, proxyUpload } =
  traeger;

/**
 * Träger exports filter by the page's query, so it travels whole. A POST
 * file request carries a letter's text and stays below 64 KiB.
 */
export const proxyFile: typeof traeger.proxyFile = (endpoint, options) =>
  traeger.proxyFile(endpoint, {
    forwardQuery: true,
    maxBodyBytes: 64 * 1024,
    ...options,
  });

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
