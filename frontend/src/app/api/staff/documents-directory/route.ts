import type { NextRequest } from "next/server";
import { portalRoutes } from "~/lib/contract/portals.generated";
import { withPrivateNoStore } from "~/lib/private-no-store";
import { catalogProxy } from "~/lib/route-wrapper.server";

// The contract registers this route (#2352). While staff/[id] keeps its own
// GET (it rebuilds the staff record), Next selects that file for this path,
// not the portal's catch-all. Hand the request to the catalog proxy with the
// path the catch-all would receive.
const path = {
  params: Promise.resolve({ path: ["staff", "documents-directory"] }),
};

const get = catalogProxy(portalRoutes.tenant, "GET");
export const GET = withPrivateNoStore((request: NextRequest) =>
  get(request, path),
);
