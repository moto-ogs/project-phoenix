import { apiErrorFromText, transportFetch } from "./api-error";
import { bffJson } from "./bff-fetch";
import { createLogger } from "~/lib/logger";
import { mapGroupsResponse } from "./group-helpers";

import type { Group as ImportedGroup } from "./group-helpers";
import { mapRoomsResponse } from "./room-helpers";

// Logger instance for API client
const logger = createLogger({ component: "ApiClient" });

/**
 * Headers for the raw fetch() call sites in the services below. The BFF
 * routes authenticate through the session cookie; the browser holds no
 * token (#5005).
 */
const JSON_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
};

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
  // Get all groups. A refused read is an error, not a school without
  // groups (#2353).
  getGroups: async (filters?: {
    page?: number;
    pageSize?: number;
  }): Promise<Group[]> => {
    try {
      const { data } = await bffJson("tenant", "GET /api/groups/", {
        query: { page: filters?.page, page_size: filters?.pageSize },
      });
      return mapGroupsResponse(data);
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
  // Get all rooms. A refused read is an error, not a school without rooms
  // (#2353).
  getRooms: async (filters?: {
    building?: string;
    category?: string;
    includeSystem?: boolean;
    page?: number;
    pageSize?: number;
  }): Promise<Room[]> => {
    try {
      const { data } = await bffJson("tenant", "GET /api/rooms/", {
        query: {
          building: filters?.building || undefined,
          category: filters?.category || undefined,
          include_system: filters?.includeSystem,
          page: filters?.page,
          page_size: filters?.pageSize,
        },
      });
      return mapRoomsResponse(data);
    } catch (error) {
      logger.error("failed to fetch rooms", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },

  // Delete a room
  deleteRoom: async (id: string): Promise<void> => {
    const url = `/api/rooms/${id}`;

    try {
      const response = await transportFetch(url, {
        method: "DELETE",
        credentials: "include",
        headers: JSON_HEADERS,
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error("api error during fetch", {
          status: response.status,
          error_text: errorText.substring(0, 200), // Truncate long errors
        });
        // Code, Feldfehler und Vorgangskennung bleiben erhalten (#2517).
        throw apiErrorFromText(
          `API error: ${response.status}`,
          response.status,
          errorText,
        );
      }
    } catch (error) {
      logger.error("failed to delete room", {
        room_id: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
};
