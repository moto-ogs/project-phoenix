import { createPublicJsonProxy } from "~/lib/backend-proxy-route.server";
import { problemResponse } from "~/lib/api-helpers.server";

/*
 * Stays (#2352): `TenantResolveResponse` still sends `tenant_id` and
 * `organization_id` as JSON numbers, which the contract no longer admits for
 * a newly registered route (ADR 0270, `NumericIDs` only shrinks). Moving
 * them to strings changes the answer for every reader of
 * `/auth/tenant/resolve` (the server-side tenant layout, its cache, older
 * bundles), a migration of its own.
 */

/** Resolve a tenant without attaching a school session. */
export const GET = createPublicJsonProxy({
  method: "GET",
  path: (request) => {
    const slug = request.nextUrl.searchParams.get("slug");
    if (!slug) {
      return problemResponse(400, "slug parameter is required", request);
    }
    return `/auth/tenant/resolve?slug=${encodeURIComponent(slug)}`;
  },
});
