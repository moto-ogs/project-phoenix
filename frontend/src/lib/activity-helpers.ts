// lib/activity-helpers.ts
// Type definitions and helper functions for activities

import type {
  ActivityCategoryResponse,
  ActivityResponse,
  ActivityScheduleResponse,
  ActivitySupervisorResponse,
  EnrolledStudentResponse,
} from "./contract/activities.generated";

// Frontend supervisor type
export interface ActivitySupervisor {
  id: string;
  staff_id: string;
  is_primary: boolean;
  first_name?: string;
  last_name?: string;
  full_name?: string;
}

// Frontend types
export interface Activity {
  id: string;
  name: string;
  max_participant: number | null;
  is_open_ags: boolean;
  supervisor_id: string;
  supervisor_name?: string;
  supervisors?: ActivitySupervisor[];
  ag_category_id: string;
  category_name?: string;
  planned_room_id?: string;
  created_at: Date;
  updated_at: Date;
  participant_count?: number;
  times?: ActivitySchedule[];
}

export interface ActivityCategory {
  id: string;
  name: string;
  description?: string;
  color?: string;
  /** Optional Dienstplan-Schichtart this category maps to (#1837 follow-up). */
  shiftTypeId?: string;
  /**
   * Auto-provisioned infrastructure category (Schulhof, WC). Read-only for
   * schools — the backend refuses every write on it (#2131). Optional because
   * older payloads (and fixtures) omit it; treat a missing value as false.
   */
  isSystem?: boolean;
  /**
   * ISO timestamp set once the category was archived. Archived categories keep
   * existing Termine and Aktivitäten valid but are not offered for new ones.
   */
  archivedAt?: string;
  /**
   * How many Aktivitäten/Termin-Vorlagen use the category. Only the category
   * list endpoint reports it.
   */
  usageCount?: number;
  created_at: Date;
  updated_at: Date;
}

interface ActivitySchedule {
  id: string;
  activity_id: string;
  weekday: string;
  timeframe_id?: string;
  created_at: Date;
  updated_at: Date;
}

/** A student enrolled in an activity, as the activity's roster lists them. */
export interface ActivityParticipant {
  id: string;
  name: string;
}

/** A staff member offered as an activity supervisor. */
export interface SupervisorOption {
  id: string;
  name: string;
}

// Helper function to map backend supervisor to frontend supervisor
function mapActivitySupervisor(
  supervisor: ActivitySupervisorResponse,
): ActivitySupervisor {
  const fullName =
    supervisor.first_name && supervisor.last_name
      ? `${supervisor.first_name} ${supervisor.last_name}`
      : undefined;

  return {
    id: String(supervisor.id),
    staff_id: String(supervisor.staff_id),
    is_primary: supervisor.is_primary,
    first_name: supervisor.first_name,
    last_name: supervisor.last_name,
    full_name: fullName,
  };
}

// Format a list of supervisors as a comma-separated string
export function formatSupervisorList(
  supervisors: ActivitySupervisor[] | undefined,
): string {
  if (!supervisors || supervisors.length === 0) {
    return "Keine Betreuer zugewiesen";
  }

  return supervisors
    .map(
      (supervisor) =>
        supervisor.full_name ??
        (supervisor.first_name && supervisor.last_name
          ? `${supervisor.first_name} ${supervisor.last_name}`
          : `Betreuer ${supervisor.id}`),
    )
    .join(", ");
}

// Helper: Extract supervisor info from backend activity
type SupervisorInfo = {
  supervisor_id: string;
  supervisor_name?: string;
  supervisors?: ActivitySupervisor[];
};

function extractSupervisorInfo(
  backendActivity: ActivityResponse,
): SupervisorInfo {
  // Has detailed supervisor array
  if (backendActivity.supervisors && backendActivity.supervisors.length > 0) {
    const supervisors = backendActivity.supervisors.map(mapActivitySupervisor);
    const primary = backendActivity.supervisors.find((s) => s.is_primary);

    if (primary) {
      const name =
        primary.first_name && primary.last_name
          ? `${primary.first_name} ${primary.last_name}`
          : undefined;
      return {
        supervisor_id: String(primary.staff_id),
        supervisor_name: name,
        supervisors,
      };
    }
    return { supervisor_id: "", supervisors };
  }

  // Fallback to old supervisor ID fields
  if (backendActivity.supervisor_id) {
    return { supervisor_id: String(backendActivity.supervisor_id) };
  }
  if (
    backendActivity.supervisor_ids &&
    backendActivity.supervisor_ids.length > 0
  ) {
    return { supervisor_id: String(backendActivity.supervisor_ids[0]) };
  }
  return { supervisor_id: "" };
}

// Helper: Map backend schedule to frontend ActivitySchedule
function mapScheduleToTime(
  schedule: ActivityScheduleResponse,
): ActivitySchedule {
  return {
    id: String(schedule.id),
    activity_id: String(schedule.activity_group_id),
    weekday: String(schedule.weekday),
    timeframe_id: schedule.timeframe_id
      ? String(schedule.timeframe_id)
      : undefined,
    created_at: new Date(schedule.created_at),
    updated_at: new Date(schedule.updated_at),
  };
}

// System activity names that cannot be deleted or renamed.
// Must stay in sync with backend constants/activities.go.
const SYSTEM_ACTIVITY_NAMES = ["Schulhof Freispiel", "WC"] as const;

/** Returns true if the activity is a system activity (Schulhof Freispiel, WC). */
export function isSystemActivity(
  activity: Activity | null | undefined,
): boolean {
  if (!activity) return false;
  return SYSTEM_ACTIVITY_NAMES.includes(
    activity.name as (typeof SYSTEM_ACTIVITY_NAMES)[number],
  );
}

// Mapping functions for backend to frontend types
export function mapActivityResponse(
  backendActivity: ActivityResponse,
): Activity {
  const supervisorInfo = extractSupervisorInfo(backendActivity);

  return {
    id: String(backendActivity.id),
    name: backendActivity.name,
    max_participant: backendActivity.max_participants,
    is_open_ags: backendActivity.is_open,
    supervisor_id: supervisorInfo.supervisor_id,
    supervisor_name: supervisorInfo.supervisor_name,
    supervisors: supervisorInfo.supervisors,
    ag_category_id: String(backendActivity.category_id),
    created_at: new Date(backendActivity.created_at),
    updated_at: new Date(backendActivity.updated_at),
    participant_count: backendActivity.enrollment_count ?? 0,
    times: backendActivity.schedules?.map(mapScheduleToTime) ?? [],
    planned_room_id: backendActivity.planned_room_id
      ? String(backendActivity.planned_room_id)
      : undefined,
    category_name: backendActivity.category?.name,
  };
}

export function mapActivityCategoryResponse(
  backendCategory: ActivityCategoryResponse,
): ActivityCategory {
  return {
    id: String(backendCategory.id),
    name: backendCategory.name,
    description: backendCategory.description,
    color: backendCategory.color,
    shiftTypeId:
      backendCategory.shift_type_id !== undefined &&
      backendCategory.shift_type_id !== null
        ? String(backendCategory.shift_type_id)
        : undefined,
    isSystem: backendCategory.is_system ?? false,
    archivedAt: backendCategory.archived_at,
    usageCount: backendCategory.usage_count,
    created_at: new Date(backendCategory.created_at),
    updated_at: new Date(backendCategory.updated_at),
  };
}

/** The view of one enrolled student of GET /api/activities/{id}/students. */
export function mapEnrolledStudentResponse(
  student: EnrolledStudentResponse,
): ActivityParticipant {
  return {
    id: student.id,
    name: `${student.first_name} ${student.last_name}`.trim(),
  };
}

// Check if a user (staff member) is the creator of an activity
export function isActivityCreator(
  activity: Activity,
  staffId: string | null | undefined,
): boolean {
  if (!staffId || !activity.supervisors || activity.supervisors.length === 0) {
    return false;
  }

  // Find the primary supervisor (creator)
  const primarySupervisor = activity.supervisors.find((s) => s.is_primary);

  // If no primary supervisor is explicitly marked, consider the first supervisor as creator
  const creator = primarySupervisor ?? activity.supervisors[0];

  return creator?.staff_id === staffId;
}

/**
 * An available supervisor (`GET /api/activities/supervisors/available`) as a
 * choice: the id is the staff id an activity write sends back.
 */
export function mapSupervisorOption(
  supervisor: ActivitySupervisorResponse,
): SupervisorOption {
  const id = supervisor.id;
  const name =
    `${supervisor.first_name ?? ""} ${supervisor.last_name ?? ""}`.trim();
  return { id, name: name || `Supervisor ${id}` };
}

// Added: Activity filter type
export interface ActivityFilter {
  category_id?: string;
}
