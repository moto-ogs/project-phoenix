// Temporary (#7563): the current client reads the AG waiting lists in the
// contract's shape through the catalog proxy and maps them itself
// (lib/course-waitlist-api); it marks its request with the header of
// lib/contract/wire, which this file hands to the proxy. Without the header,
// an installed app with an older bundle still gets the mapped lists this
// file builds. Delete this file after the next production deploy; the
// portal's catch-all then answers the path.
import type { NextRequest } from "next/server";
import { apiGet } from "~/lib/api-helpers.server";
import { portalRoutes } from "~/lib/contract/portals.generated";
import { asksForContractWire } from "~/lib/contract/wire";
import {
  mapCourseWaitlists,
  type CourseWaitlist,
  type CourseWaitlistWire,
} from "~/lib/course-waitlist-helpers";
import { withPrivateNoStore } from "~/lib/private-no-store";
import type { RouteContext } from "~/lib/route-wrapper-utils.server";
import { allowedQueryString } from "~/lib/route-wrapper-utils.server";
import { catalogProxy, createGetHandler } from "~/lib/route-wrapper.server";

interface BackendEnvelope {
  data: CourseWaitlistWire[] | null;
}

/**
 * Wartelisten der AGs für das Team (#4767). Mit `activity_group_id` nur die
 * eine AG, auch wenn niemand auf sie wartet. Lesbar mit users:update, wie die
 * Entscheidung über die Anfragen selbst.
 */
const legacyGet = createGetHandler(
  async (request, token): Promise<CourseWaitlist[]> => {
    const response = await apiGet<BackendEnvelope>(
      `/api/students/offering-change-requests/course-waitlists${allowedQueryString(request, ["activity_group_id"])}`,
      token,
    );
    return mapCourseWaitlists(response.data ?? []);
  },
);

// The path the portal's catch-all would receive for this route.
const catalogPath = {
  params: Promise.resolve({
    path: ["students", "offering-change-requests", "course-waitlists"],
  }),
};
const catalogGet = catalogProxy(portalRoutes.tenant, "GET");

export const GET = withPrivateNoStore(
  (request: NextRequest, context: RouteContext) =>
    asksForContractWire(request)
      ? catalogGet(request, catalogPath)
      : legacyGet(request, context),
);
