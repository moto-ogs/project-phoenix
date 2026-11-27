import type {
  enrichedInstance,
  materializeResponse,
  templateResponse,
} from "~/lib/contract/timetable.generated";

/**
 * Builds a block of the week plan as the catalog proxy hands it on
 * (`enrichedInstance`): IDs are strings and every field Go always writes is
 * set.
 */
export function buildEnrichedInstance(
  overrides?: Partial<enrichedInstance>,
): enrichedInstance {
  return {
    id: "1",
    date: "2026-09-09",
    start_time: "14:00",
    end_time: "15:00",
    title: "Block",
    status: "planned",
    is_spontaneous: false,
    is_live: false,
    activity_type: "care",
    room_id: "1",
    room_name: "",
    version: "v1",
    staff: [],
    student_ids: [],
    students: [],
    staff_count: 0,
    absent_staff_count: 0,
    understaffed_ack: false,
    expected_students_count: 0,
    present_students_count: 0,
    current_students_count: 0,
    not_scheduled_students_count: 0,
    required_staff_count: 0,
    assigned_staff_count: 0,
    conflict_warnings: null,
    can_complete: false,
    complete_available_at: "",
    ...overrides,
  };
}

/** Builds a materialization result of the contract (`materializeResponse`). */
export function buildMaterializeResponse(
  overrides?: Partial<materializeResponse>,
): materializeResponse {
  return {
    from: "2026-09-07",
    to: "2026-09-13",
    instances_created: 0,
    candidates_skipped_existing: 0,
    candidates_skipped_exception: 0,
    candidates_skipped_ab_week: 0,
    candidates_skipped_no_period: 0,
    candidates_skipped_incomplete: 0,
    skipped_ended: 0,
    skipped_not_started: 0,
    skipped_holidays: 0,
    skipped_closing_days: 0,
    skipped_closed_rooms: 0,
    candidates_raced: 0,
    instance_students_created: 0,
    instance_staff_created: 0,
    warnings: null,
    duration_ms: 0,
    ...overrides,
  };
}

/** Builds a Regeltermin of the contract (`templateResponse`). */
export function buildTemplateResponse(
  overrides?: Partial<templateResponse>,
): templateResponse {
  return {
    id: "1",
    name: "Regeltermin",
    type: "care",
    category_id: "1",
    category_name: "",
    is_open: false,
    max_participants: null,
    target_group_type: "none",
    targets: null,
    include_closing_days: false,
    enrollment_count: 0,
    supervisor_count: 0,
    required_staff_count: 0,
    assigned_staff_count: 0,
    student_ids: null,
    staff_ids: null,
    schedules: null,
    weekday_assignments: null,
    protected_student_assignments: null,
    manual_roster_confirmed: false,
    ...overrides,
  };
}
