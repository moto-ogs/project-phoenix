import type { NextRequest } from "next/server";
import { forwardDemoToken } from "../forward";
import { withPrivateNoStore } from "~/lib/private-no-store";
import { routes } from "~/lib/contract/demo-access.generated";

/*
 * Stays (#2352): the browser sends the demo token in the body, and the
 * backend's `GET /demo/access/status` reads it as the bearer. The catalog
 * proxy sends only the session's bearer, or nothing on a public route, and
 * the demo routes exist only in the demo environment (APP_ENV=demo).
 */

async function POSTHandler(request: NextRequest) {
  return forwardDemoToken(request, routes["GET /demo/access/status"]);
}

export const POST = withPrivateNoStore(POSTHandler);
