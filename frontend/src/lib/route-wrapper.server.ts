import type { NextRequest } from "next/server";
import { tenantPortal } from "~/server/auth";
import { sendBackend } from "./backend-client.server";
import { forwardJsonRequest, type JsonProxyOptions } from "./json-proxy.server";
import {
  makeCatalogProxy,
  type CatalogMethod,
  type CatalogRoute,
} from "./contract/catalog-proxy.server";
import { CATALOG_OUTSIDE_MOUNTS } from "./contract/catalog-outside-mounts";
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
 * for the routes the contract registers for this portal.
 */
export const catalogProxy = (
  routes: readonly CatalogRoute[],
  method: CatalogMethod,
) =>
  makeCatalogProxy(
    tenant,
    "/api",
    routes,
    method,
    CATALOG_OUTSIDE_MOUNTS.tenant,
  );
