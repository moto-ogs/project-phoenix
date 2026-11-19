import type {
  ActivityCategoryResponse,
  ActivityResponse,
} from "~/lib/contract/activities.generated";

let activityIdCounter = 0;
let categoryIdCounter = 0;

function nextActivityId() {
  return ++activityIdCounter;
}

function nextCategoryId() {
  return ++categoryIdCounter;
}

/**
 * Builds an activity as the contract answers it (`ActivityResponse`).
 */
export function buildBackendActivity(
  overrides?: Partial<ActivityResponse>,
): ActivityResponse {
  const id = overrides?.id ?? String(nextActivityId());
  return {
    id,
    name: "Basketball AG",
    max_participants: 20,
    is_open: true,
    category_id: "1",
    created_by: null,
    supervisor_id: "10",
    enrollment_count: 15,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

/**
 * Builds a category as the contract answers it (`ActivityCategoryResponse`).
 */
export function buildBackendCategory(
  overrides?: Partial<ActivityCategoryResponse>,
): ActivityCategoryResponse {
  const id = overrides?.id ?? String(nextCategoryId());
  return {
    id,
    name: "Sport",
    description: "Sports activities",
    color: "#3b82f6",
    is_system: false,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}
