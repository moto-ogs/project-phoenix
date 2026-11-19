import { apiErrorFromResponse, transportFetch } from "./api-error";
// Client API for the info-point display domain (issue #1325).
// Admin CRUD goes through the portal's catalog proxy under /api/display;
// the public dashboard fetch is token-only.

import type {
  InfoDisplayCreatedResponse,
  InfoDisplayResponse,
  InfoDisplayTokenResponse,
  InfoDisplayWriteRequest,
} from "~/lib/contract/display.generated";
import type { InfoDisplay } from "~/lib/display-helpers";
import { mapDisplayResponse } from "~/lib/display-helpers";
import { dataOrBare } from "~/lib/envelope-or-bare";

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
// Admin CRUD (session-authenticated)
// ---------------------------------------------------------------------------
//
// The management routes go through the portal's catalog proxy under
// /api/display (#7563), where the backend answers in the shared envelope.
// Temporary (#7563): for one release a display answer may still arrive in
// the backend's former bare form ({displays}, {display}); dataOrBare and the
// two readers below accept both. Read `data` directly afterwards.

async function readData<T>(response: Response): Promise<T> {
  if (!response.ok) {
    // Code, Feldfehler und Vorgangskennung kommen aus dem Fehlerumschlag.
    throw await apiErrorFromResponse(
      response,
      `display request failed (${response.status})`,
    );
  }
  return dataOrBare<T>(await response.json());
}

export async function listDisplays(): Promise<InfoDisplay[]> {
  const response = await transportFetch("/api/display/", { cache: "no-store" });
  const answer = await readData<
    InfoDisplayResponse[] | { displays?: InfoDisplayResponse[] } | null
  >(response);
  const displays = Array.isArray(answer) ? answer : (answer?.displays ?? []);
  return displays.map(mapDisplayResponse);
}

export interface DisplayWithToken {
  display: InfoDisplay;
  token: string;
}

export async function createDisplay(name: string): Promise<DisplayWithToken> {
  const response = await transportFetch("/api/display/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name } satisfies InfoDisplayWriteRequest),
  });
  const data = await readData<InfoDisplayCreatedResponse>(response);
  return { display: mapDisplayResponse(data.display), token: data.token };
}

export async function updateDisplay(
  id: string,
  changes: { name?: string; isActive?: boolean },
): Promise<InfoDisplay> {
  const body: InfoDisplayWriteRequest = {
    ...(changes.name !== undefined ? { name: changes.name } : {}),
    ...(changes.isActive !== undefined ? { is_active: changes.isActive } : {}),
  };
  const response = await transportFetch(
    `/api/display/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const answer = await readData<
    InfoDisplayResponse | { display: InfoDisplayResponse }
  >(response);
  return mapDisplayResponse("display" in answer ? answer.display : answer);
}

export async function regenerateDisplayToken(id: string): Promise<string> {
  const response = await transportFetch(
    `/api/display/${encodeURIComponent(id)}/regenerate`,
    { method: "POST" },
  );
  const data = await readData<InfoDisplayTokenResponse>(response);
  return data.token;
}

export async function deleteDisplay(id: string): Promise<void> {
  const response = await transportFetch(
    `/api/display/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
    },
  );
  if (!response.ok) {
    throw await apiErrorFromResponse(
      response,
      `display delete failed (${response.status})`,
    );
  }
}
