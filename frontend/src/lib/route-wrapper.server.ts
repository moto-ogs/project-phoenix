import { tenantPortal } from "~/server/auth";
import {
  handOffUnder,
  makeCatalogProxy,
  type CatalogMethod,
  type CatalogRoute,
  type HandOffHead,
} from "./contract/catalog-proxy.server";
import {
  CATALOG_OUTSIDE_MOUNTS,
  CATALOG_PUBLIC_OUTSIDE_MOUNTS,
} from "./contract/catalog-outside-mounts";
import { makePortalHandlers } from "./portal-handlers.server";

export { isStringParam } from "./route-wrapper-utils.server";

/** The tenant portal's route handlers; see makePortalHandlers. */
export const tenant = makePortalHandlers(tenantPortal);

export const {
  get: createGetHandler,
  post: createPostHandler,
  put: createPutHandler,
  patch: createPatchHandler,
  del: createDeleteHandler,
  delWithBody: createDeleteWithBodyHandler,
  jsonProxy: createTenantJsonProxy,
  proxyFile,
  proxyUpload,
  proxyGet,
  proxyPost,
  proxyPut,
  proxyPatch,
  proxyDelete,
} = tenant;

/**
 * The staff portal's proxy: forwards `/api/…` to the backend's `/api/…`
 * for the routes the contract registers for this portal, and the public
 * routes under that mount without a session (`portalRoutes.public`).
 */
export const catalogProxy = (
  routes: readonly CatalogRoute[],
  method: CatalogMethod,
  publicRoutes: readonly CatalogRoute[] = [],
) =>
  makeCatalogProxy(
    tenant,
    "/api",
    routes,
    method,
    CATALOG_OUTSIDE_MOUNTS.tenant,
    { routes: publicRoutes, outside: CATALOG_PUBLIC_OUTSIDE_MOUNTS.tenant },
  );

/**
 * The staff portal's proxy for a route file below `/api/<head…>` that Next
 * would give another file: the file's catch-all `path` is the tail after the
 * head, so the head goes in front again before the proxy matches it.
 */
export function catalogProxyUnder(
  head: HandOffHead,
  routes: readonly CatalogRoute[],
  method: CatalogMethod,
) {
  return handOffUnder(head, catalogProxy(routes, method));
}
