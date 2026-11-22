// lib/activity-api.ts
import type {
  ActivityCategoryResponse,
  ActivityResponse,
} from "./contract/activities.generated";
import { bffJson } from "./bff-fetch";
import { sessionFetch } from "./session-cache";
import { handleDomainApiError } from "./api-helpers";
import { ApiError, apiErrorFromResponse } from "./api-error";

// Error handler using shared utility. A structured ApiError (browser path)
// passes through unchanged, so code, field errors and request ID reach the
// shared display path.
function handleActivityApiError(error: unknown, context: string): never {
  if (error instanceof ApiError) throw error;
  handleDomainApiError(error, context);
}
import {
  mapEnrolledStudentResponse,
  mapActivityCategoryResponse,
  mapActivityResponse,
  type Activity,
  type ActivityCategory,
  type UpdateActivityRequest,
  type ActivityFilter,
  type ActivityParticipant,
} from "./activity-helpers";

// Re-export types for external use
export type { Activity, ActivityCategory } from "./activity-helpers";

// Helper: Build URL with query params for activities
function buildActivitiesUrl(baseUrl: string, filters?: ActivityFilter): string {
  const params = new URLSearchParams();
  if (filters?.search) params.append("search", filters.search);
  if (filters?.category_id) params.append("category_id", filters.category_id);
  if (filters?.is_open_ags !== undefined) {
    params.append("is_open_ags", filters.is_open_ags.toString());
  }
  const queryString = params.toString();
  return queryString ? `${baseUrl}?${queryString}` : baseUrl;
}

/** The data of GET /api/activities: the contract's list in the envelope. */
function parseActivitiesResponse(responseData: {
  data: ActivityResponse[] | null;
}): Activity[] {
  return (responseData.data ?? []).map(mapActivityResponse);
}

// Get all activities
export async function fetchActivities(
  filters?: ActivityFilter,
): Promise<Activity[]> {
  const baseUrl = "/api/activities";
  const url = buildActivitiesUrl(baseUrl, filters);

  // Browser environment: use fetch with our Next.js API route
  const response = await sessionFetch(url, {
    method: "GET",
  });

  if (!response.ok) {
    throw await apiErrorFromResponse(response, `API error: ${response.status}`);
  }

  return parseActivitiesResponse(
    (await response.json()) as { data: ActivityResponse[] | null },
  );
}

/** The students enrolled in an activity. */
export async function getEnrolledStudents(
  activityId: string,
): Promise<ActivityParticipant[]> {
  const students = await bffJson(
    "tenant",
    "GET /api/activities/{id}/students",
    {
      params: { id: activityId },
    },
  );
  return students.map(mapEnrolledStudentResponse);
}

// Update an activity
export async function updateActivity(
  id: string,
  data: UpdateActivityRequest,
): Promise<Activity> {
  const url = `/api/activities/${id}`;

  const response = await sessionFetch(url, {
    method: "PUT",
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw await apiErrorFromResponse(response, `API error: ${response.status}`);
  }

  const responseData = (await response.json()) as { data: ActivityResponse };
  return mapActivityResponse(responseData.data);
}

// Delete an activity
export async function deleteActivity(id: string): Promise<void> {
  const url = `/api/activities/${id}`;

  const response = await sessionFetch(url, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw await apiErrorFromResponse(response, `API error: ${response.status}`);
  }
}

// Get all categories
export async function getCategories(): Promise<ActivityCategory[]> {
  const url = "/api/activities/categories";

  try {
    const response = await sessionFetch(url, {
      method: "GET",
    });

    if (!response.ok) {
      throw await apiErrorFromResponse(
        response,
        `API error: ${response.status}`,
      );
    }

    const responseData = (await response.json()) as {
      data: ActivityCategoryResponse[] | null;
    };
    return (responseData.data ?? []).map(mapActivityCategoryResponse);
  } catch (error) {
    handleActivityApiError(error, "fetch categories");
  }
}
