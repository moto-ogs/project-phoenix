import type { NextRequest } from "next/server";
import { portalRoutes } from "~/lib/contract/portals.generated";
import { catalogProxy } from "~/lib/route-wrapper.server";

const post = catalogProxy(portalRoutes.tenant, "POST");

// Without this literal route, Next selects guardians/[id], not the portal's
// catch-all. Delegate with the path that the catch-all would receive.
export const POST = (request: NextRequest) =>
  post(request, {
    params: Promise.resolve({ path: ["guardians", "bulk-invite"] }),
  });
