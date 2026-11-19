import { portalRoutes } from "~/lib/contract/portals.generated";
import { catalogProxy } from "~/lib/route-wrapper.server";

/*
 * The staff portal's proxy (#2352). It answers every `/api/…` path without a
 * route file of its own, and forwards only what the generated contract
 * registers for the portal `tenant`; everything else is a 404. A path of another
 * portal (`/api/parent/…`) never matches: every pattern of this list starts
 * with the backend's `/api/` or with a path of the portal's fixed list beside
 * that mount (`lib/contract/catalog-outside-mounts.ts`). The public routes
 * under `/api` (enrollment links and forms) and the care contract link run
 * here without a session. A route with behavior of its own (session, files,
 * uploads, SSE) keeps its file, and Next prefers that file over this one.
 */
const routes = portalRoutes.tenant;
// The routes of a link or a public form, served without a session.
const publicRoutes = portalRoutes.public;

export const GET = catalogProxy(routes, "GET", publicRoutes);
export const POST = catalogProxy(routes, "POST", publicRoutes);
export const PUT = catalogProxy(routes, "PUT", publicRoutes);
export const PATCH = catalogProxy(routes, "PATCH", publicRoutes);
export const DELETE = catalogProxy(routes, "DELETE", publicRoutes);
