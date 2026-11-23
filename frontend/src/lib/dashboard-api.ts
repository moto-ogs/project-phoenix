import { bffJson } from "./bff-fetch";
import type { DashboardAnalytics } from "./dashboard-helpers";
import { mapDashboardAnalyticsResponse } from "./dashboard-helpers";

/**
 * Client-side fetcher for SWR. Reads the dashboard figures through the
 * portal's catalog proxy (#7563) and maps the contract's shape once.
 */
export async function fetchDashboardAnalyticsClient(): Promise<DashboardAnalytics> {
  return mapDashboardAnalyticsResponse(
    await bffJson("tenant", "GET /api/active/analytics/dashboard", {
      errorMessage: "Dashboard fetch failed",
    }),
  );
}
