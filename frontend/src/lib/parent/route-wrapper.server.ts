import { parentPortal } from "~/server/auth/parent";
import {
  makeCatalogProxy,
  type CatalogMethod,
  type CatalogRoute,
} from "../contract/catalog-proxy.server";
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
) => makeCatalogProxy(parent, "/parent", routes, method);
