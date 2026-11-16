import { parentPortal } from "~/server/auth/parent";
import { unwrapEnvelope } from "../backend-client.server";
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
  del: createParentDeleteHandler,
  put: createParentPutHandler,
  patch: createParentPatchHandler,
  jsonProxy: createParentJsonProxy,
} = parent;

export const parentApiDelete = async <T>(endpoint: string, token: string) =>
  unwrapEnvelope<T>(await parent.api("DELETE", endpoint, token));

export const parentApiPut = async <T, B = unknown>(
  endpoint: string,
  token: string,
  body?: B,
) => unwrapEnvelope<T>(await parent.api("PUT", endpoint, token, body));

/**
 * The guardians' portal proxy: forwards `/api/parent/…` to the backend's
 * `/parent/…` for the routes the contract registers for this portal.
 */
export const catalogProxy = (
  routes: readonly CatalogRoute[],
  method: CatalogMethod,
) => makeCatalogProxy(parent, "/parent", routes, method);
