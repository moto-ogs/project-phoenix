import type { NextRequest } from "next/server";
import { portalRoutes } from "~/lib/contract/portals.generated";
import { catalogProxy, proxyPost } from "~/lib/parent/route-wrapper.server";
import { withPrivateNoStore } from "~/lib/private-no-store";
import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";

interface SickNoteBody {
  dates: string[];
  reason?: string;
  status?: string;
  recipient_guardian_profile_ids?: string[];
}

const catalogGet = catalogProxy(portalRoutes.parent, "GET");

/**
 * GET /api/parent/me/children/{studentId}/sick-note: the child's active sick
 * days (today .. +2 months by default). The contract registers the route, so
 * the parent portal's catalog proxy answers it; this file only hands the
 * request over, because Next gives the path to this file, not to the
 * catch-all.
 */
export const GET = withPrivateNoStore(
  async (
    request: NextRequest,
    context: { params: Promise<Record<string, string | string[] | undefined>> },
  ) => {
    const { studentId } = await context.params;
    return catalogGet(request, {
      params: Promise.resolve({
        path: ["me", "children", String(studentId ?? ""), "sick-note"],
      }),
    });
  },
);

/**
 * Proxy POST /api/parent/me/children/{studentId}/sick-note → backend
 * /parent/me/children/{studentId}/sick-note. The route-wrapper injects
 * the parent session token + 401 retry. The backend verifies the account
 * is a guardian of the child (account id from the JWT, never the URL) and
 * answers `{status_days, pending_request}`.
 *
 * Temporary (#2352): the backend answers that envelope always now and the
 * contract registers both methods for the parent portal's catalog proxy. This
 * file still asks with `?envelope=1`, so a backend from before this release
 * answers the same shape during the rollout, and bundles that send the flag
 * keep working. Delete this file after the next production deploy; the
 * catalog proxy then serves GET and POST.
 */
export const POST = proxyPost<unknown, SickNoteBody>(
  (params) =>
    `/parent/me/children/${requirePathSegmentParam(params, "studentId")}/sick-note?envelope=1`,
);
