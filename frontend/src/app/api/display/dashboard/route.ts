import { createPublicJsonProxy } from "~/lib/backend-proxy-route.server";
import { problemResponse } from "~/lib/api-helpers.server";

/*
 * Stays (#2352): the display authenticates with its own credential, the
 * opaque `X-Display-Token` header, which this file forwards. The catalog
 * proxy sends only the session's bearer, or nothing on a public route, and
 * forwards no credential of the browser; teaching it a header per route
 * would open a second credential path through every portal's proxy for one
 * route. `GET /api/display/dashboard` is not in the contract either.
 */

/** The opaque display header, not a browser session, grants backend access. */
export const GET = createPublicJsonProxy({
  method: "GET",
  path: (request) =>
    request.headers.get("x-display-token")
      ? "/api/display/dashboard"
      : problemResponse(400, "token required", request),
  additionalHeaders: (request) => ({
    "X-Display-Token": request.headers.get("x-display-token") ?? "",
  }),
});
