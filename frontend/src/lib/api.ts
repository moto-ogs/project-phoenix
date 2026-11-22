import { ApiError, apiErrorFromBody } from "./api-error";
import { bffJson } from "./bff-fetch";
import { clearSessionCache, getCachedSession } from "./session-cache";
import { createLogger } from "~/lib/logger";
import { fetchWithRetry } from "./api-helpers";
import { mapGroupsResponse } from "./group-helpers";

import type { GroupWire, Group as ImportedGroup } from "./group-helpers";
import { mapRoomsResponse } from "./room-helpers";

import type { RoomResponse } from "./contract/rooms.generated";
import { handleAuthFailure } from "./auth-failure";

// Logger instance for API client
const logger = createLogger({ component: "ApiClient" });

/**
 * Re-read the session after a 401 → refresh (helper for fetchWithRetry).
 * The cached session is stale by definition — drop it first, or this (and
 * every concurrent caller for up to 10s) would skip the lookup that persists
 * the rotated cookie before the retry.
 */
async function reloadSession(): Promise<void> {
  clearSessionCache();
  await getCachedSession();
}

/**
 * The refusal fetchWithRetry reported, with code, details and request ID of
 * the backend envelope when its body carried one (ADR 0006).
 */
function accessDeniedApiError(status?: 401 | 403, body?: unknown): ApiError {
  const accessDeniedStatus = status ?? 401;
  return apiErrorFromBody(
    accessDeniedStatus === 403 ? "Access denied" : "Authentication failed",
    accessDeniedStatus,
    body,
  );
}

/**
 * Build query parameters for room filters.
 */
function buildRoomQueryParams(filters?: {
  building?: string;
  floor?: number;
  category?: string;
  occupied?: boolean;
  search?: string;
  includeSystem?: boolean;
  page?: number;
  pageSize?: number;
}): URLSearchParams {
  const params = new URLSearchParams();
  if (filters?.search) params.append("search", filters.search);
  if (filters?.building) params.append("building", filters.building);
  if (filters?.floor !== undefined)
    params.append("floor", filters.floor.toString());
  if (filters?.category) params.append("category", filters.category);
  if (filters?.occupied !== undefined)
    params.append("occupied", filters.occupied.toString());
  if (filters?.page !== undefined)
    params.append("page", filters.page.toString());
  if (filters?.pageSize !== undefined)
    params.append("page_size", filters.pageSize.toString());
  if (filters?.includeSystem !== undefined)
    params.append("include_system", String(filters.includeSystem));
  return params;
}

/**
 * The list of a list response: the wrapped `{data: [...]}` envelope or a bare
 * array; `{data: null}` is the empty list of a Go nil slice. Any other shape
 * is a broken answer and rejects (#2353): an empty list would read as "no
 * rooms" or "no groups" instead of a failure.
 */
function parseListResponse<T>(responseData: unknown, what: string): T[] {
  if (Array.isArray(responseData)) return responseData as T[];
  if (
    responseData &&
    typeof responseData === "object" &&
    "data" in responseData
  ) {
    const list = (responseData as { data?: unknown }).data;
    if (list === null) return [];
    if (Array.isArray(list)) return list as T[];
  }
  logger.warn("invalid list response", {
    resource: what,
    response_type: typeof responseData,
  });
  throw new ApiError(`invalid ${what} response`, 500);
}

// Re-export types for external usage
export type { Student } from "./student-helpers";
export type Group = ImportedGroup;

// Room-related interfaces
export interface Room {
  id: string;
  name: string;
  building?: string;
  floor?: number; // Optional (nullable in DB)
  capacity?: number; // Optional (nullable in DB)
  category?: string; // Optional (nullable in DB)
  color?: string; // Optional (nullable in DB)
  deviceId?: string;
  isOccupied: boolean;
  activityName?: string;
  groupName?: string;
  supervisorName?: string;
  studentCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

// Group service for API operations
export const groupService = {
  // Get all groups
  getGroups: async (filters?: {
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<Group[]> => {
    const params = new URLSearchParams();
    if (filters?.search) params.append("search", filters.search);

    if (filters?.page !== undefined) params.set("page", String(filters.page));
    if (filters?.pageSize !== undefined)
      params.set("page_size", String(filters.pageSize));

    const queryString = params.toString();
    const baseUrl = "/api/groups";
    const url = queryString ? `${baseUrl}?${queryString}` : baseUrl;

    try {
      const { response, data, accessDeniedStatus, accessDeniedBody } =
        await fetchWithRetry<unknown>(url, {
          onAuthFailure: handleAuthFailure,
          beforeRetry: reloadSession,
        });

      // A refused read is an error, not a school without groups (#2353).
      if (response === null) {
        throw accessDeniedApiError(accessDeniedStatus, accessDeniedBody);
      }

      return mapGroupsResponse(parseListResponse<GroupWire>(data, "groups"));
    } catch (error) {
      logger.error("failed to fetch groups", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
};

// Room service for API operations
export const roomService = {
  // Get all rooms
  getRooms: async (filters?: {
    building?: string;
    floor?: number;
    category?: string;
    occupied?: boolean;
    search?: string;
    includeSystem?: boolean;
    page?: number;
    pageSize?: number;
  }): Promise<Room[]> => {
    const params = buildRoomQueryParams(filters);
    const queryString = params.toString();

    const baseUrl = "/api/rooms";
    const url = queryString ? `${baseUrl}?${queryString}` : baseUrl;

    try {
      const { response, data, accessDeniedStatus, accessDeniedBody } =
        await fetchWithRetry<unknown>(url, {
          onAuthFailure: handleAuthFailure,
          beforeRetry: reloadSession,
        });

      // A refused read is an error, not a school without rooms (#2353).
      if (response === null) {
        throw accessDeniedApiError(accessDeniedStatus, accessDeniedBody);
      }

      return mapRoomsResponse(parseListResponse<RoomResponse>(data, "rooms"));
    } catch (error) {
      logger.error("failed to fetch rooms", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },

  // Delete a room
  deleteRoom: async (id: string): Promise<void> => {
    try {
      // Code, Feldfehler und Vorgangskennung bleiben erhalten (#2517).
      await bffJson("tenant", "DELETE /api/rooms/{id}", { params: { id } });
    } catch (error) {
      logger.error("failed to delete room", {
        room_id: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
};
