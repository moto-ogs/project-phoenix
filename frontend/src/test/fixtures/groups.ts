import type * as groupsContract from "~/lib/contract/groups.generated";

let groupIdCounter = 0;

function nextId() {
  return ++groupIdCounter;
}

/**
 * Builds a decoded group response with sensible defaults.
 */
export function buildBackendGroup(
  overrides?: Partial<groupsContract.GroupResponse>,
): groupsContract.GroupResponse {
  const id = overrides?.id ?? String(nextId());
  return {
    id,
    name: "Class 3A",
    room_id: "10",
    student_count: 0,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-15T12:00:00Z",
    ...overrides,
  };
}
