// app/api/activities/[id]/route.ts
//
// Temporary (#7563): the contract registers GET, PUT and DELETE /api/activities/{id}, and the
// current client reads the contract's shape through the catalog proxy. An
// installed bundle of the previous release reads the shape this file maps.
// Delete this file after the next production deploy; the portal's catch-all
// then answers the path.
import type { ActivityResponse } from "~/lib/contract/activities.generated";
import type { NextRequest } from "next/server";
import { apiGet, apiPut, apiDelete } from "~/lib/api-helpers.server";
import {
  createGetHandler,
  createPutHandler,
  createDeleteHandler,
} from "~/lib/route-wrapper.server";
import type { Activity, UpdateActivityRequest } from "~/lib/activity-helpers";
import { mapActivityResponse } from "~/lib/activity-helpers";

/**
 * Handler for GET /api/activities/[id]
 * Returns a single activity by ID
 */
export const GET = createGetHandler(
  async (
    request: NextRequest,
    token: string,
    params: Record<string, unknown>,
  ) => {
    const id = params.id as string;

    const response = await apiGet<
      ActivityResponse | { status: string; data: ActivityResponse }
    >(`/api/activities/${encodeURIComponent(id)}`, token);

    // Handle both response formats (raw object or wrapped in status/data)
    if (response) {
      if (
        "status" in response &&
        response.status === "success" &&
        "data" in response
      ) {
        // Handle wrapped response { status: "success", data: ActivityResponse }
        return mapActivityResponse(response.data);
      } else if ("id" in response) {
        // Handle direct response (ActivityResponse)
        return mapActivityResponse(response);
      }
    }

    throw new Error("Unexpected response structure");
  },
);

/**
 * Handler for PUT /api/activities/[id]
 * Updates an existing activity
 */
export const PUT = createPutHandler<Activity, UpdateActivityRequest>(
  async (
    _request: NextRequest,
    body: UpdateActivityRequest,
    token: string,
    params: Record<string, unknown>,
  ) => {
    const id = params.id as string;
    const activityId = Number.parseInt(id, 10);

    if (Number.isNaN(activityId)) {
      throw new TypeError("Invalid activity ID");
    }

    // The body already matches the UpdateActivityRequest structure expected by backend
    const response = await apiPut<
      ActivityResponse | { status: string; data: ActivityResponse },
      UpdateActivityRequest
    >(
      `/api/activities/${encodeURIComponent(id)}`,
      token,
      body, // Send the raw UpdateActivityRequest
    );

    // Handle both response formats (raw object or wrapped in status/data)
    if (response) {
      if (
        "status" in response &&
        response.status === "success" &&
        "data" in response
      ) {
        // Handle wrapped response { status: "success", data: ActivityResponse }
        return mapActivityResponse(response.data);
      } else if ("id" in response) {
        // Handle direct response (ActivityResponse)
        return mapActivityResponse(response);
      }
    }

    throw new Error("Unexpected response structure");
  },
);

/**
 * Handler for DELETE /api/activities/[id]
 * Removes an activity by ID
 */
export const DELETE = createDeleteHandler(
  async (
    request: NextRequest,
    token: string,
    params: Record<string, unknown>,
  ) => {
    const id = params.id as string;
    const activityId = Number.parseInt(id, 10);

    if (Number.isNaN(activityId)) {
      throw new TypeError("Invalid activity ID");
    }

    const response = await apiDelete<{
      status?: string | number;
      success?: boolean;
    }>(`/api/activities/${encodeURIComponent(id)}`, token);

    // Backend typically returns no content on successful delete
    if (
      !response ||
      (response.status && response.status === 204) ||
      (response.status && response.status === "204") ||
      response.success
    ) {
      return { success: true };
    }

    // Also handle the case where status might be "success"
    if (response.status && response.status === "success") {
      return { success: true };
    }

    throw new Error("Unexpected response structure");
  },
);
