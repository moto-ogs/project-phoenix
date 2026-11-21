import type { enrichedInstance } from "~/lib/contract/timetable.generated";

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
