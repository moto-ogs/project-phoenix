import type {
  OperationPlannedInstance,
  OperationRoster,
  OperationRosterInstance,
  OperationRosterRow,
} from "~/lib/contract/shared.generated";

/**
 * Builders for the block answers of the contract (`OperationRoster`,
 * `OperationPlannedInstance`), as the catalog proxy hands them on: IDs are
 * strings and every field Go always writes is set.
 */
export function buildOperationRosterRow(
  overrides?: Partial<OperationRosterRow>,
): OperationRosterRow {
  return {
    student_id: "1",
    student_name: "Kind",
    school_class: "",
    group_name: "",
    planned: true,
    is_unplanned: false,
    currently_present: false,
    status: "expected",
    pickup_time: null,
    care_day_status: "scheduled",
    ...overrides,
  };
}

export function buildOperationRosterInstance(
  overrides?: Partial<OperationRosterInstance>,
): OperationRosterInstance {
  return {
    id: "1",
    title: "Block",
    status: "planned",
    is_spontaneous: false,
    room_id: "1",
    date: "2026-09-09",
    start_time: "14:00",
    end_time: "15:00",
    can_complete: false,
    complete_available_at: "",
    ...overrides,
  };
}

export function buildOperationRoster(
  overrides?: Partial<OperationRoster>,
): OperationRoster {
  return {
    instance: buildOperationRosterInstance(),
    rows: [],
    pickup_times_loaded: true,
    can_operate: true,
    can_start: true,
    can_end: true,
    can_edit_attendance: true,
    can_report_absence: true,
    can_record_homework_feedback: false,
    ...overrides,
  };
}

export function buildOperationPlannedInstance(
  overrides?: Partial<OperationPlannedInstance>,
): OperationPlannedInstance {
  return {
    id: "1",
    title: "Block",
    date: "2026-09-09",
    start_time: "14:00",
    end_time: "15:00",
    room_id: "1",
    status: "planned",
    is_overdue: false,
    minutes_until_start: 0,
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
    pickup_times_loaded: true,
    warnings: null,
    can_start: false,
    start_available_at: "",
    start_expires_at: "",
    ...overrides,
  };
}
