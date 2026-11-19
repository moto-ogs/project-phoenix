import { createPublicJsonProxy } from "~/lib/backend-proxy-route.server";
import { NextRequest } from "next/server";
import { withPrivateNoStore } from "~/lib/private-no-store";

/**
 * Temporary (#2352): remove after the next production deploy. The current
 * client calls `/api/auth/tenants`, the backend path, through the staff
 * portal's catalog proxy; this file stays one release for an installed app
 * with an older bundle that still calls this path.
 */

/** List public tenant names without attaching a school session. */
const proxy = createPublicJsonProxy({
  method: "GET",
  path: "/auth/tenants",
});

// Keep the no-argument entry point used by existing server-side callers.
export const GET = withPrivateNoStore(
  (
    request: NextRequest = new NextRequest("http://localhost/api/tenant/list"),
  ) => proxy(request),
);
