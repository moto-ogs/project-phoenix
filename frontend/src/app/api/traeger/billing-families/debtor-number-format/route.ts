import type { NextRequest } from "next/server";
import { portalRoutes } from "~/lib/contract/portals.generated";
import { withPrivateNoStore } from "~/lib/private-no-store";
import { catalogProxy } from "~/lib/traeger/route-wrapper.server";

const get = catalogProxy(portalRoutes.org, "GET");

// Without this literal route, Next selects billing-families/[id], not the
// portal's catch-all. Delegate with the path that the catch-all would receive.
export const GET = withPrivateNoStore((request: NextRequest) =>
  get(request, {
    params: Promise.resolve({
      path: ["billing-families", "debtor-number-format"],
    }),
  }),
);
