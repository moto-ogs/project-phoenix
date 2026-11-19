import type { NextRequest } from "next/server";
import { portalRoutes } from "~/lib/contract/portals.generated";
import { withPrivateNoStore } from "~/lib/private-no-store";
import { catalogProxy } from "~/lib/route-wrapper.server";

const get = catalogProxy(portalRoutes.tenant, "GET");

// Without this literal route, Next selects students/[id], not the portal's
// catch-all. Delegate with the path that the catch-all would receive.
export const GET = withPrivateNoStore((request: NextRequest) =>
  get(request, {
    params: Promise.resolve({ path: ["students", "care-offerings"] }),
  }),
);
