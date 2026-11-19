import { describe, it, expect, vi, beforeEach } from "vitest";
import { activityService } from "./activity-service";
import type { Activity, ActivityFilter } from "./activity-helpers";

// Mock all activity-api imports
vi.mock("./activity-api", () => ({
  fetchActivities: vi.fn(),
}));

describe("ActivityService", () => {
  let mockFetchActivities: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // Import after mocks are set up
    const activityApiModule = await import("./activity-api");

    mockFetchActivities =
      activityApiModule.fetchActivities as typeof mockFetchActivities;

    vi.clearAllMocks();
  });

  describe("getActivities", () => {
    it("delegates to fetchActivities with filters", async () => {
      const mockActivities: Activity[] = [
        { id: "1", name: "Test Activity" } as Activity,
      ];
      mockFetchActivities.mockResolvedValue(mockActivities);

      const filters: ActivityFilter = { search: "active" };
      const result = await activityService.getActivities(filters);

      expect(mockFetchActivities).toHaveBeenCalledWith(filters);
      expect(result).toBe(mockActivities);
    });

    it("delegates to fetchActivities without filters", async () => {
      const mockActivities: Activity[] = [];
      mockFetchActivities.mockResolvedValue(mockActivities);

      const result = await activityService.getActivities();

      expect(mockFetchActivities).toHaveBeenCalledWith(undefined);
      expect(result).toBe(mockActivities);
    });
  });
});
