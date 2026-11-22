import { apiErrorFromResponse, unavailableApiError } from "./api-error";
// Client API for the info-point display domain (issue #1325).
// Admin CRUD goes through the portal's catalog proxy under /api/display;
// the public dashboard fetch is token-only.

import { bffJson } from "~/lib/bff-fetch";
import type * as displayContract from "~/lib/contract/display.generated";
import type { InfoDisplay } from "~/lib/display-helpers";
import { mapDisplayResponse } from "~/lib/display-helpers";

/**
 * Fetches the public dashboard aggregate. No session required — the token
 * authenticates via the X-Display-Token header (never the URL, so it stays
 * out of request-path logs). Throws an ApiError on non-OK responses
 * (404 = unknown/revoked token).
 */
export async function fetchDisplayDashboard(
  token: string,
  signal?: AbortSignal,
): Promise<displayContract.DashboardResponse> {
  // The wall display has no session and its answer has no envelope
  // (`plain`): neither fits a portal of bffJson, so it fetches the route
  // file itself (old-fetch-helpers.test.ts lists it).
  let response: Response;
  try {
    response = await fetch("/api/display/dashboard", {
      cache: "no-store",
      signal,
      headers: { "X-Display-Token": token },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw unavailableApiError(error);
  }
  if (!response.ok) {
    throw await apiErrorFromResponse(
      response,
      `display dashboard request failed with status ${response.status}`,
    );
  }
  return (await response.json()) as displayContract.DashboardResponse;
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
