import type { NextRequest } from "next/server";
import { portalRoutes } from "~/lib/contract/portals.generated";
import { withPrivateNoStore } from "~/lib/private-no-store";
import { catalogProxy } from "~/lib/route-wrapper.server";

const post = catalogProxy(portalRoutes.tenant, "POST");

// Without this literal route, Next selects students/[id], not the portal's
// catch-all. Delegate with the path that the catch-all would receive.
export const POST = withPrivateNoStore((request: NextRequest) =>
  post(request, {
    params: Promise.resolve({ path: ["students", "care-end"] }),
  }),
);
