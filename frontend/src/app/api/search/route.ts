// Temporary (#7563): the current client sends the school search to the
// catalog proxy and maps the contract's answer itself (lib/school-search,
// lib/school-search-wire); it marks its request with the header of
// lib/contract/wire, which this file hands to the proxy. Without the header,
// an installed app with an older bundle still gets the mapped answer this
// file builds. Delete this file and its test after the next production
// deploy; the portal's catch-all then answers the path.
import type { NextRequest } from "next/server";
import { apiPost } from "~/lib/api-helpers.server";
import { portalRoutes } from "~/lib/contract/portals.generated";
import { asksForContractWire } from "~/lib/contract/wire";
import { withPrivateNoStore } from "~/lib/private-no-store";
import type { RouteContext } from "~/lib/route-wrapper-utils.server";
import { catalogProxy, createPostHandler } from "~/lib/route-wrapper.server";
import type { SchoolSearchResult } from "~/lib/school-search";
import {
  mapSchoolSearchResult,
  type BackendSchoolSearchResult,
} from "~/lib/school-search-wire";

/**
 * The school search (#6954). The query stays in the body; this handler logs
 * nothing about it.
 */
const legacyPost = createPostHandler<SchoolSearchResult, { query?: unknown }>(
  async (_request, body, token) => {
    const query = typeof body?.query === "string" ? body.query : "";
    const response = await apiPost<{ data: BackendSchoolSearchResult }>(
      "/api/search",
      token,
      { query },
    );
    return mapSchoolSearchResult(response.data);
  },
);

// The path the portal's catch-all would receive for /api/search.
const catalogPath = { params: Promise.resolve({ path: ["search"] }) };
const catalogPost = catalogProxy(portalRoutes.tenant, "POST");

export const POST = withPrivateNoStore(
  (request: NextRequest, context: RouteContext) =>
    asksForContractWire(request)
      ? catalogPost(request, catalogPath)
      : legacyPost(request, context),
);
