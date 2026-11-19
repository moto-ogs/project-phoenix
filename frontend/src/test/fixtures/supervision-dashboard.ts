import type {
  PlannedInstance,
  DashboardProjection,
  RosterRow,
} from "~/lib/contract/active.generated";

/** An empty supervision projection in the contract's shape (#7563). */
export function buildSupervisionDashboardWire(
  overrides?: Partial<DashboardProjection>,
): DashboardProjection {
  return {
    business_day: "2026-08-31",
    spontaneous_start_availability: { available: true },
    groups: [],
    unclaimed_groups: [],
    educational_groups: [],
    schulhof_status: null,
    open_rooms: [],
    capabilities: { web_spontaneous_activities_enabled: false },
    active_sessions: [],
    planned_now: [],
    visits: [],
    tracking_indicators: { labels: [], results: {} },
    pickup_times: [],
    arrival_times: [],
    teacher_hints: [],
    ...overrides,
  };
}

/** A planned block of the projection with neutral defaults. */
export function buildPlannedInstanceWire(
  overrides?: Partial<PlannedInstance>,
): PlannedInstance {
  return {
    id: "7",
    title: "Basteln",
    date: "2026-08-31",
    start_time: "14:00",
    end_time: "15:00",
    room_id: "3",
    status: "planned",
    is_overdue: false,
    minutes_until_start: 10,
    expected_students_count: 0,
    present_students_count: 0,
    not_scheduled_students_count: 0,
    current_students_count: 0,
    planned_students_count: 0,
    is_spontaneous: false,
    assigned_staff_ids: [],
    is_assigned: false,
    is_primary: false,
    is_substitute: false,
    is_absent: false,
    pickup_times_loaded: false,
    warnings: [],
    can_start: false,
    start_available_at: "",
    start_expires_at: "",
    ...overrides,
  };
}

/** A roster row of a planned block with neutral defaults. */
export function buildRosterRowWire(overrides?: Partial<RosterRow>): RosterRow {
  return {
    student_id: "100",
    student_name: "Kind Eins",
    school_class: "1a",
    group_name: "OGS A",
    planned: true,
    is_unplanned: false,
    currently_present: false,
    status: "expected",
    pickup_time: null,
    care_day_status: "scheduled",
    ...overrides,
  };
}
