import type { NextRequest } from "next/server";
import { portalRoutes } from "~/lib/contract/portals.generated";
import { withPrivateNoStore } from "~/lib/private-no-store";
import { catalogProxy } from "~/lib/traeger/route-wrapper.server";

// Code step in the running Träger session (#7068). Next selects
// auth/[...nextauth] for this path, not the portal's catch-all, so this file
// hands the request to the catalog proxy with the path the catch-all would
// receive. The contract switches the renewal's retry off: a renewed session
// would mail the code twice.
const path = { params: Promise.resolve({ path: ["auth", "mfa", "step-up"] }) };

const post = catalogProxy(portalRoutes.org, "POST");
export const POST = withPrivateNoStore((request: NextRequest) =>
  post(request, path),
);
