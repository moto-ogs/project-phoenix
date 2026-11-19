import { createPublicJsonProxy } from "~/lib/backend-proxy-route.server";
import { problemResponse } from "~/lib/api-helpers.server";

/**
 * Temporary (#2352): remove after the next production deploy. The current
 * client calls `/api/auth/invitations/{token}`, the backend path, through the
 * staff portal's catalog proxy; this file stays one release for an installed
 * app with an older bundle that still calls this path.
 */

export const GET = createPublicJsonProxy({
  method: "GET",
  path: (request) => {
    const token = request.nextUrl.searchParams.get("token");
    if (!token) {
      return problemResponse(400, "Missing invitation token", request);
    }
    return `/auth/invitations/${encodeURIComponent(token)}`;
  },
});
