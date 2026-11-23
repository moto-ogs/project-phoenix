import type * as activeContract from "~/lib/contract/active.generated";

let activeGroupIdCounter = 0;
let visitIdCounter = 0;
let supervisorIdCounter = 0;

function nextActiveGroupId() {
  return ++activeGroupIdCounter;
}

function nextVisitId() {
  return ++visitIdCounter;
}

function nextSupervisorId() {
  return ++supervisorIdCounter;
}

/**
 * Builds a ActiveGroupWire with sensible defaults.
 */
export function buildBackendActiveSession(
  overrides?: Partial<activeContract.ActiveGroupResponse>,
): activeContract.ActiveGroupResponse {
  const id = overrides?.id ?? String(nextActiveGroupId());
  return {
    id,
    group_id: "10",
    room_id: "5",
    start_time: "2024-01-15T08:00:00Z",
    end_time: "2024-01-15T12:00:00Z",
    is_active: true,
    visit_count: 25,
    supervisor_count: 2,
    room: { id: "5", name: "Room A", color: "#5080D8" },
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-15T08:00:00Z",
    ...overrides,
  };
}

/**
 * Builds a VisitWire with sensible defaults.
 */
export function buildBackendVisit(
  overrides?: Partial<activeContract.VisitResponse>,
): activeContract.VisitResponse {
  const id = overrides?.id ?? String(nextVisitId());
  return {
    id,
    student_id: "50",
    active_group_id: "1",
    check_in_time: "2024-01-15T08:30:00Z",
    check_out_time: "2024-01-15T11:45:00Z",
    is_active: false,
    student_name: "Max Mustermann",
    active_group_name: "Morning Session",
    created_at: "2024-01-15T08:30:00Z",
    updated_at: "2024-01-15T11:45:00Z",
    ...overrides,
  };
}

/**
 * Builds a SupervisorWire with sensible defaults.
 */
export function buildBackendSupervisor(
  overrides?: Partial<activeContract.SupervisorResponse>,
): activeContract.SupervisorResponse {
  const id = overrides?.id ?? String(nextSupervisorId());
  return {
    id,
    staff_id: "30",
    active_group_id: "1",
    start_time: "2024-01-15T08:00:00Z",
    end_time: "2024-01-15T12:00:00Z",
    is_active: true,
    staff_name: "Frau Schmidt",
    active_group_name: "Morning Session",
    created_at: "2024-01-15T08:00:00Z",
    updated_at: "2024-01-15T08:00:00Z",
    ...overrides,
  };
}
