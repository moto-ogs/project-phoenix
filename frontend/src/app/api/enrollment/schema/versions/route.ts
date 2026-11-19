import type { NextRequest } from "next/server";
import { portalRoutes } from "~/lib/contract/portals.generated";
import { withPrivateNoStore } from "~/lib/private-no-store";
import { catalogProxy } from "~/lib/route-wrapper.server";

// The sibling schema/[id] keeps its own file (it reshapes the PUT and PATCH
// bodies), so Next selects it for this path instead of the portal's
// catch-all. Hand the request to the catalog proxy with the path the
// catch-all would receive (#2352).
const path = {
  params: Promise.resolve({ path: ["enrollment", "schema", "versions"] }),
};

const get = catalogProxy(portalRoutes.tenant, "GET");
export const GET = withPrivateNoStore((request: NextRequest) =>
  get(request, path),
);
