// Temporary (#7563): the current client reads
// GET /api/active/analytics/dashboard through the portal's catalog proxy and
// maps it itself. An installed bundle of the previous release still calls
// this path and reads the mapped figures. Delete this file, its test and
// lib/dashboard-api.server after the next production deploy.
import type { NextRequest } from "next/server";
import { fetchDashboardAnalytics } from "~/lib/dashboard-api.server";
import { createGetHandler } from "~/lib/route-wrapper.server";

/**
 * Handler for GET /api/dashboard/analytics
 * Returns aggregated dashboard analytics data
 */
export const GET = createGetHandler(
  async (
    _request: NextRequest,
    token: string,
    _params: Record<string, unknown>,
  ) => {
    // Fetch dashboard analytics from the backend
    return await fetchDashboardAnalytics(token);
  },
);
