import { portalRoutes } from "~/lib/contract/portals.generated";
import { catalogProxy } from "~/lib/operator/route-wrapper.server";

/*
 * The operator portal's proxy (#2352). It answers every `/api/operator/…` path without a
 * route file of its own, and forwards only what the generated contract
 * registers for the portal `platform`; everything else is a 404. A route
 * with behavior of its own (session, files, uploads, SSE) keeps its file, and
 * Next prefers that file over this one.
 */
const routes = portalRoutes.platform;

export const GET = catalogProxy(routes, "GET");
export const POST = catalogProxy(routes, "POST");
export const PUT = catalogProxy(routes, "PUT");
export const PATCH = catalogProxy(routes, "PATCH");
export const DELETE = catalogProxy(routes, "DELETE");
