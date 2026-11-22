import { apiErrorFromResponse, transportFetch } from "./api-error";
// Client API for the info-point display domain (issue #1325).
// Admin CRUD goes through the portal's catalog proxy under /api/display;
// the public dashboard fetch is token-only.

import { bffJson } from "~/lib/bff-fetch";
import type * as displayContract from "~/lib/contract/display.generated";
import type { InfoDisplay } from "~/lib/display-helpers";
import { mapDisplayResponse } from "~/lib/display-helpers";

// ---------------------------------------------------------------------------
// Public dashboard payload (mirrors backend services/display DashboardPayload)
// ---------------------------------------------------------------------------

export interface DashboardRoomOccupancy {
  name: string;
  group_name?: string;
  category_name?: string;
  student_count: number;
  capacity?: number | null;
  is_occupied: boolean;
}

export interface DashboardRunningActivity {
  id: string;
  name: string;
  category: string;
  room_name: string;
  participants: number;
  max_capacity?: number | null;
}

export interface DashboardUpcomingActivity {
  id: string;
  name: string;
  category: string;
  start_time: string; // HH:MM
  room_name: string;
}

export interface DashboardPickupBucket {
  time: string; // HH:MM
  count: number;
}

export interface DashboardPayload {
  status: "active" | "inactive";
  school_name?: string;
  display_name?: string;
  server_time?: string;
  date?: string; // YYYY-MM-DD
  room_occupancy?: DashboardRoomOccupancy[];
  running_activities?: DashboardRunningActivity[];
  upcoming_activities?: DashboardUpcomingActivity[];
  pickup_times?: DashboardPickupBucket[];
  totals?: {
    students_present: number;
    rooms_occupied: number;
    activities_running: number;
  };
}

/**
 * Fetches the public dashboard aggregate. No session required — the token
 * authenticates via the X-Display-Token header (never the URL, so it stays
 * out of request-path logs). Throws an ApiError on non-OK responses
 * (404 = unknown/revoked token).
 */
export async function fetchDisplayDashboard(
  token: string,
  signal?: AbortSignal,
): Promise<DashboardPayload> {
  const response = await transportFetch("/api/display/dashboard", {
    cache: "no-store",
    signal,
    headers: { "X-Display-Token": token },
  });
  if (!response.ok) {
    throw await apiErrorFromResponse(
      response,
      `display dashboard request failed with status ${response.status}`,
    );
  }
  return (await response.json()) as DashboardPayload;
}

// ---------------------------------------------------------------------------
// Admin CRUD (session-authenticated, tenant routes under /api/display)
// ---------------------------------------------------------------------------

export async function listDisplays(): Promise<InfoDisplay[]> {
  const displays = await bffJson("tenant", "GET /api/display/");
  return displays.map(mapDisplayResponse);
}

export interface DisplayWithToken {
  display: InfoDisplay;
  token: string;
}

export async function createDisplay(name: string): Promise<DisplayWithToken> {
  const data = await bffJson("tenant", "POST /api/display/", {
    body: { name },
  });
  return { display: mapDisplayResponse(data.display), token: data.token };
}

export async function updateDisplay(
  id: string,
  changes: { name?: string; isActive?: boolean },
): Promise<InfoDisplay> {
  const body: displayContract.InfoDisplayWriteRequest = {
    ...(changes.name !== undefined ? { name: changes.name } : {}),
    ...(changes.isActive !== undefined ? { is_active: changes.isActive } : {}),
  };
  return mapDisplayResponse(
    await bffJson("tenant", "PATCH /api/display/{id}", {
      params: { id },
      body,
    }),
  );
}

export async function regenerateDisplayToken(id: string): Promise<string> {
  const data = await bffJson("tenant", "POST /api/display/{id}/regenerate", {
    params: { id },
  });
  return data.token;
}

export async function deleteDisplay(id: string): Promise<void> {
  await bffJson("tenant", "DELETE /api/display/{id}", { params: { id } });
}
