// Lookup lists of the planner: rooms, groups and activity categories, read
// through the tenant catalog routes.
import { bffJson } from "./bff-fetch";
import type * as groupsContract from "./contract/groups.generated";
import type * as roomsContract from "./contract/rooms.generated";
import {
  mapActivityCategoryResponse,
  type ActivityCategory,
} from "./activity-helpers";

const PAGE_SIZE = 1000;

export async function fetchPlannerRooms(): Promise<
  roomsContract.RoomResponse[]
> {
  const rooms: roomsContract.RoomResponse[] = [];
  for (let page = 1, totalPages = 1; page <= totalPages; page += 1) {
    const answer = await bffJson("tenant", "GET /api/rooms/", {
      query: { page, page_size: PAGE_SIZE },
      errorMessage: "Reference request failed",
    });
    rooms.push(...answer.data);
    totalPages = answer.pagination.total_pages;
  }
  return rooms;
}

export async function fetchPlannerActivityCategories(): Promise<
  ActivityCategory[]
> {
  const categories = await bffJson("tenant", "GET /api/activities/categories", {
    errorMessage: "Reference request failed",
  });
  return categories.map(mapActivityCategoryResponse);
}

export async function fetchPlannerGroups(): Promise<
  groupsContract.GroupResponse[]
> {
  const answer = await bffJson("tenant", "GET /api/groups/", {
    query: { page_size: PAGE_SIZE },
    errorMessage: "Reference request failed",
  });
  return answer.data;
}
