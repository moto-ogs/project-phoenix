import type { NextRequest } from "next/server";
import { forwardDemoToken } from "../forward";
import { withPrivateNoStore } from "~/lib/private-no-store";

/*
 * Stays (#2352): the browser sends the demo token in the body, and the
 * backend's `GET /demo/access/status` reads it as the bearer. The catalog
 * proxy sends only the session's bearer, or nothing on a public route, and
 * the demo routes exist only in the demo environment (APP_ENV=demo), so they
 * are not in the contract either.
 */

async function POSTHandler(request: NextRequest) {
  return forwardDemoToken(request, "status");
}

export const POST = withPrivateNoStore(POSTHandler);
