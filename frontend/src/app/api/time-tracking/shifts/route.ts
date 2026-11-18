import type { NextRequest } from "next/server";
import { portalRoutes } from "~/lib/contract/portals.generated";
import { withPrivateNoStore } from "~/lib/private-no-store";
import { catalogProxy } from "~/lib/route-wrapper.server";

// Temporary (#2352): while time-tracking/[id] keeps its PUT for one release,
// Next selects that file for this path, not the portal's catch-all. Hand the
// request to the catalog proxy with the path the catch-all would receive.
const path = {
  params: Promise.resolve({ path: ["time-tracking", "shifts"] }),
};

const get = catalogProxy(portalRoutes.tenant, "GET");
export const GET = withPrivateNoStore((request: NextRequest) =>
  get(request, path),
);
