import type { NextRequest } from "next/server";
import { portalRoutes } from "~/lib/contract/portals.generated";
import { withPrivateNoStore } from "~/lib/private-no-store";
import { catalogProxy } from "~/lib/route-wrapper.server";

// Temporary (#7563): while activities/[id] keeps its route file for one
// release, Next selects that file for this path, not the portal's catch-all.
// Hand the request to the catalog proxy with the path the catch-all would
// receive. Delete this file together with activities/[id]/route.ts.
const path = {
  params: Promise.resolve({ path: ["activities", "quick-create"] }),
};

const post = catalogProxy(portalRoutes.tenant, "POST");
export const POST = withPrivateNoStore((request: NextRequest) =>
  post(request, path),
);
