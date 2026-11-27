import { bffJson } from "./bff-fetch";
import { createLogger } from "~/lib/logger";
import { mapGroupsResponse } from "./group-helpers";

import type { Group as ImportedGroup } from "./group-helpers";
import { mapRoomsResponse } from "./room-helpers";

// Logger instance for API client
const logger = createLogger({ component: "ApiClient" });

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
    includeSystem?: boolean;
    /** Calendar day for which rooms closed by a temporary closure are omitted. */
    openOn?: string;
    page?: number;
    pageSize?: number;
  }): Promise<Room[]> => {
    try {
      const { data } = await bffJson("tenant", "GET /api/rooms/", {
        query: {
          include_system: filters?.includeSystem,
          open_on: filters?.openOn,
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
};
