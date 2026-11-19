import { fetchActivities } from "./activity-api";
import type { Activity, ActivityFilter } from "./activity-helpers";

class ActivityService {
  async getActivities(filters?: ActivityFilter): Promise<Activity[]> {
    return fetchActivities(filters);
  }
}

export const activityService = new ActivityService();
