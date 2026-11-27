import type { NextResponse } from "next/server";
import { operatorPortal } from "~/server/auth/operator";
import type { ErrorCode } from "~/lib/error-codes.generated";
import { problemResponse } from "../api-response-error.server";
import {
  handOffUnder,
  makeCatalogProxy,
  type CatalogMethod,
  type CatalogRoute,
  type HandOffHead,
} from "../contract/catalog-proxy.server";
import { CATALOG_OUTSIDE_MOUNTS } from "../contract/catalog-outside-mounts";
import { makePortalHandlers } from "../portal-handlers.server";

/**
 * An error the operator BFF answers itself (#2519): a registered code for the
 * client and an English diagnostic, never a UI sentence. The client shows the
 * catalog text of the code.
 */
export function operatorErrorResponse(
  status: number,
  code: ErrorCode,
  diagnostic: string,
  request?: Request,
): NextResponse {
  return problemResponse(status, diagnostic, { code }, request);
}

/** The operator portal's route handlers, on the operator session only. */
export const operator = makePortalHandlers(operatorPortal);

/**
 * The operator portal's proxy: forwards `/api/operator/…` to the backend's `/operator/…`
 * for the routes the contract registers for this portal.
 */
export const catalogProxy = (
  routes: readonly CatalogRoute[],
  method: CatalogMethod,
  publicRoutes: readonly CatalogRoute[] = [],
) =>
  makeCatalogProxy(
    operator,
    "/operator",
    routes,
    method,
    CATALOG_OUTSIDE_MOUNTS.platform,
    {
      routes: publicRoutes,
    },
  );

/**
 * The operator portal's proxy for a route file below its BFF prefix that Next would
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
