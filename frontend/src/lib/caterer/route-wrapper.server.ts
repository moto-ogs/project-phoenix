import { catererPortal } from "~/server/auth/caterer";
import {
  makeCatalogProxy,
  type CatalogMethod,
  type CatalogRoute,
} from "../contract/catalog-proxy.server";
import { makePortalHandlers } from "../portal-handlers.server";

/** The caterer portal's route handlers (ADR 0077), on the caterer session. */
export const caterer = makePortalHandlers(catererPortal);

export const {
  proxyGet,
  proxyPost,
  jsonProxy: createCatererJsonProxy,
} = caterer;

/**
 * The caterer portal's proxy: forwards `/api/caterer/…` to the backend's `/caterer/…`
 * for the routes the contract registers for this portal.
 */
export const catalogProxy = (
  routes: readonly CatalogRoute[],
  method: CatalogMethod,
) => makeCatalogProxy(caterer, "/caterer", routes, method);
