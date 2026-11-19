import { portalRoutes } from "~/lib/contract/portals.generated";
import { catalogProxy } from "~/lib/traeger/route-wrapper.server";

/*
 * The Träger portal's proxy (#2352). It answers every `/api/traeger/…` path without a
 * route file of its own, and forwards only what the generated contract
 * registers for the portal `org`; everything else is a 404. A route
 * with behavior of its own (session, SSE, a file or upload it reshapes) keeps its file, and
 * Next prefers that file over this one.
 */
const routes = portalRoutes.org;
// The routes of a link or a public form, served without a session.
const publicRoutes = portalRoutes.public;

export const GET = catalogProxy(routes, "GET", publicRoutes);
export const POST = catalogProxy(routes, "POST", publicRoutes);
export const PUT = catalogProxy(routes, "PUT", publicRoutes);
export const PATCH = catalogProxy(routes, "PATCH", publicRoutes);
export const DELETE = catalogProxy(routes, "DELETE", publicRoutes);
