import { createTenantJsonProxy } from "~/lib/route-wrapper.server";

/**
 * Temporary (#2352): the current client reads the account's schools at
 * `/api/auth/account/tenants`, the backend path, through the staff portal's
 * catalog proxy. This file stays one release for an installed app with an
 * older bundle that still calls this path; delete it after the next
 * production deploy.
 */
export const GET = createTenantJsonProxy({
  method: "GET",
  path: "/auth/account/tenants",
});
