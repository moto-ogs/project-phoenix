// lib/activity-api.ts
import { bffJson } from "./bff-fetch";
import type { ActivityRequest } from "./contract/activities.generated";
import { handleDomainApiError } from "./api-helpers";
import { ApiError } from "./api-error";
import {
  mapEnrolledStudentResponse,
  mapActivityCategoryResponse,
  mapActivityResponse,
  type Activity,
  type ActivityCategory,
  type ActivityFilter,
  type ActivityParticipant,
} from "./activity-helpers";

// Error handler using shared utility. A structured ApiError (browser path)
// passes through unchanged, so code, field errors and request ID reach the
// shared display path.
function handleActivityApiError(error: unknown, context: string): never {
  if (error instanceof ApiError) throw error;
  handleDomainApiError(error, context);
}

// Re-export types for external use
export type { Activity, ActivityCategory } from "./activity-helpers";

/** Every activity of the school, optionally of one category. */
export async function fetchActivities(
  filters?: ActivityFilter,
): Promise<Activity[]> {
  const activities = await bffJson("tenant", "GET /api/activities/", {
    query: { category_id: filters?.category_id },
  });
  return activities.map(mapActivityResponse);
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
  data: ActivityRequest,
): Promise<Activity> {
  const activity = await bffJson("tenant", "PUT /api/activities/{id}", {
    params: { id },
    body: data,
  });
  return mapActivityResponse(activity);
}

// Delete an activity
export async function deleteActivity(id: string): Promise<void> {
  await bffJson("tenant", "DELETE /api/activities/{id}", { params: { id } });
}

// Get all categories
export async function getCategories(): Promise<ActivityCategory[]> {
  try {
    const categories = await bffJson(
      "tenant",
      "GET /api/activities/categories",
    );
    return categories.map(mapActivityCategoryResponse);
  } catch (error) {
    handleActivityApiError(error, "fetch categories");
  }
}
