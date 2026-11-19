import type { NextRequest } from "next/server";
import { tenantPortal } from "~/server/auth";
import { sendBackend } from "./backend-client.server";
import { forwardJsonRequest, type JsonProxyOptions } from "./json-proxy.server";
import {
  makeCatalogProxy,
  type CatalogMethod,
  type CatalogRoute,
} from "./contract/catalog-proxy.server";
import {
  CATALOG_OUTSIDE_MOUNTS,
  CATALOG_PUBLIC_OUTSIDE_MOUNTS,
} from "./contract/catalog-outside-mounts";
import { makePortalHandlers } from "./portal-handlers.server";

import type { RouteContext } from "./route-wrapper-utils.server";

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
 * Registration may carry a tenant session (admin role checks) or none; the
 * backend decides. No retry: without a session there is nothing to renew.
 */
export function createOptionalTenantJsonProxy(options: JsonProxyOptions) {
  return tenantPortal.withAuth(async (request: NextRequest, context) => {
    const token = (await tenantPortal.auth())?.user?.token;
    return forwardJsonRequest(request, context, options, (path, call) =>
      sendBackend(path, token, { ...call, request }),
    );
  });
}

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
  head: readonly string[],
  routes: readonly CatalogRoute[],
  method: CatalogMethod,
) {
  const handler = catalogProxy(routes, method);
  return (request: NextRequest, context: RouteContext) =>
    handler(request, {
      params: context.params.then((params) => {
        const tail = params.path;
        const rest = Array.isArray(tail) ? tail : tail ? [tail] : [];
        return { ...params, path: [...head, ...rest] };
      }),
    });
}
