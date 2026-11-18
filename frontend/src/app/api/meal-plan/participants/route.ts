import type { NextRequest } from "next/server";
import { portalRoutes } from "~/lib/contract/portals.generated";
import { catalogProxy } from "~/lib/route-wrapper.server";

const get = catalogProxy(portalRoutes.tenant, "GET");

// Without this literal route, Next selects meal-plan/[date], not the portal's
// catch-all. Delegate with the path that the catch-all would receive.
export const GET = (request: NextRequest) =>
  get(request, {
    params: Promise.resolve({ path: ["meal-plan", "participants"] }),
  });
