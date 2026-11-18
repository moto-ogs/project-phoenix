import type { NextRequest } from "next/server";
import { portalRoutes } from "~/lib/contract/portals.generated";
import { withPrivateNoStore } from "~/lib/private-no-store";
import { catalogProxy } from "~/lib/route-wrapper.server";

// While staff/[id] keeps its own route file (it reshapes the staff record),
// Next selects that file for this path, not the portal's catch-all (#2352).
// Hand the request to the catalog proxy with the path the catch-all would
// receive; delete this file together with staff/[id]/route.ts.
const path = {
  params: Promise.resolve({ path: ["staff", "dashboard-summary"] }),
};

const get = catalogProxy(portalRoutes.tenant, "GET");
export const GET = withPrivateNoStore((request: NextRequest) =>
  get(request, path),
);
