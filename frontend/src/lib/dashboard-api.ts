import { apiErrorFromResponse, unavailableApiError } from "./api-error";
import type { DashboardAnalyticsResponse } from "./contract/active.generated";
import { fetchWithAuth } from "./fetch-with-auth";
import type { DashboardAnalytics } from "./dashboard-helpers";
import { mapDashboardAnalyticsResponse } from "./dashboard-helpers";

/**
 * Client-side fetcher for SWR. Reads the dashboard figures through the
 * portal's catalog proxy (#7563) and maps the contract's shape once.
 */
export async function fetchDashboardAnalyticsClient(): Promise<DashboardAnalytics> {
  let response: Response;
  try {
    response = await fetchWithAuth("/api/active/analytics/dashboard");
  } catch (error) {
    throw unavailableApiError(error);
  }

  if (!response.ok) {
    throw await apiErrorFromResponse(
      response,
      `Dashboard fetch failed: ${response.status}`,
    );
  }

  const json = (await response.json()) as { data: DashboardAnalyticsResponse };
  return mapDashboardAnalyticsResponse(json.data);
}
