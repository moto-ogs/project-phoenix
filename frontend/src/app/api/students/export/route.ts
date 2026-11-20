import type { NextRequest } from "next/server";
import { portalRoutes } from "~/lib/contract/portals.generated";
import { withPrivateDownloadNoStore } from "~/lib/private-no-store";
import { catalogProxy } from "~/lib/route-wrapper.server";

const post = catalogProxy(portalRoutes.tenant, "POST");

// The child list export streams through the portal's catalog proxy (#2352).
// Without this literal route, Next selects students/[id], not the catch-all.
export const POST = withPrivateDownloadNoStore((request: NextRequest) =>
  post(request, { params: Promise.resolve({ path: ["students", "export"] }) }),
);
