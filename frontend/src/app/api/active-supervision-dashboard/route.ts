// Temporary (#7563): app bundles built before #7563 still fetch the
// supervision dashboard here and expect the camelCase view. New bundles fetch
// GET /api/active/supervision-dashboard through the catalog proxy and map it
// in the client. Delete this file after the next production deploy.
import type { NextRequest } from "next/server";
import { routes } from "~/lib/contract/active.generated";
import { contractGet } from "~/lib/contract/client.server";
import { createGetHandler } from "~/lib/route-wrapper.server";
import { mapSupervisionDashboard } from "~/lib/supervision-dashboard-wire";

const DASHBOARD = routes["GET /api/active/supervision-dashboard"];

/**
 * GET /api/active-supervision-dashboard?group_id={activeGroupId}
 *
 * One backend request; an invalid group_id is dropped as before, an unknown
 * one is a backend 403.
 */
export const GET = createGetHandler(
  async (request: NextRequest, token: string) => {
    const groupId = request.nextUrl.searchParams.get("group_id");
    const query =
      groupId && /^[1-9]\d{0,18}$/.test(groupId)
        ? `?group_id=${encodeURIComponent(groupId)}`
        : "";
    const result = await contractGet(
      "GET /api/active/supervision-dashboard",
      DASHBOARD.response,
      `/api/active/supervision-dashboard${query}`,
      token,
    );
    if (!result.ok) throw result.error.cause;
    return mapSupervisionDashboard(result.value.data);
  },
);
