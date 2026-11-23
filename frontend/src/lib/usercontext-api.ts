// lib/usercontext-api.ts
import { ApiError } from "./api-error";
import { bffJson } from "./bff-fetch";
import { createLogger } from "~/lib/logger";
import {
  mapEducationalGroupResponse,
  mapActiveGroupResponse,
  mapStaffResponse,
  type EducationalGroup,
  type ActiveGroup,
  type Staff,
} from "./usercontext-helpers";

const logger = createLogger({ component: "UserContextAPI" });

export const userContextService = {
  // Get current user's staff profile
  getCurrentStaff: async (): Promise<Staff> => {
    try {
      const staff = await bffJson("tenant", "GET /api/me/staff", {
        errorMessage: "Get current staff failed",
      });
      if (!staff) {
        // The account is linked to no staff record, as the 404 says.
        throw new ApiError("Get current staff failed: no staff record", 404);
      }
      return mapStaffResponse(staff);
    } catch (error) {
      // Suppress 404 logs (account not linked to a person) to avoid noisy console
      if (!(error instanceof ApiError && error.status === 404)) {
        logger.error("get current staff error", { error: String(error) });
      }
      throw error;
    }
  },

  // Get educational groups for current user
  getMyEducationalGroups: async (): Promise<EducationalGroup[]> => {
    try {
      const groups = await bffJson("tenant", "GET /api/me/groups/", {
        errorMessage: "Get educational groups failed",
      });
      return groups.map(mapEducationalGroupResponse);
    } catch (error) {
      logger.error("get educational groups error", { error: String(error) });
      throw error;
    }
  },

  // Get supervised groups for current user
  getMySupervisedGroups: async (): Promise<ActiveGroup[]> => {
    try {
      const groups = await bffJson("tenant", "GET /api/me/groups/supervised", {
        errorMessage: "Get supervised groups failed",
      });
      return groups.map(mapActiveGroupResponse);
    } catch (error) {
      logger.error("get supervised groups error", { error: String(error) });
      throw error;
    }
  },
};
