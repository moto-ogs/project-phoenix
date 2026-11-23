import {
  HOMEWORK_FEEDBACK_STATUSES,
  type HomeworkFeedbackStatus,
} from "./homework-feedback";
import type { CareDayStatus } from "./timetable-types";
import { knownEnum } from "./contract/known-enum";
import type * as sharedContract from "./contract/shared.generated";

import type * as studentsContract from "~/lib/contract/students.generated";

// Go does not register these sets; the contract types them as string. A value
// this build does not know stays undefined instead of passing as a known one.
const BLOCK_STATUS_VALUES = [
  "planned",
  "active",
  "completed",
  "cancelled",
] as const;
const ROW_STATUS_VALUES = ["expected", "present", "absent"] as const;
const SUBSTATUS_VALUES = [
  "late",
  "excused",
  "sick",
  "field_trip",
  "other",
] as const;
const CARE_DAY_STATUS_VALUES = [
  "scheduled",
  "not_scheduled",
  "cancelled",
  "unknown",
] as const satisfies readonly CareDayStatus[];

/** undefined: a status this build does not know. */
type BlockStatus = (typeof BLOCK_STATUS_VALUES)[number] | undefined;
type RosterRowStatus = (typeof ROW_STATUS_VALUES)[number];
type RosterRowSubstatus = (typeof SUBSTATUS_VALUES)[number];
export interface PlannedTimetableInstance {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  roomId: string;
  roomName: string | null;
  status: BlockStatus;
  isOverdue: boolean;
  minutesUntilStart: number;
  expectedStudentsCount: number;
  presentStudentsCount: number;
  /**
   * Assigned children whose care plan does not place them here today (#1747).
   * Excluded from expectedStudentsCount; shown next to it so a lower expected
   * number is explained rather than silently smaller.
   */
  notScheduledStudentsCount: number;
  /**
   * Kinder, die gerade da sind: anwesend und nicht gegangen, auch ungeplant
   * dazugekommene (#3921). presentStudentsCount zählt die Gegangenen mit.
   */
  currentStudentsCount?: number;
  /**
   * Die eigenen Kinder des Blocks an diesem Tag: noch erwartet oder schon
   * gekommen, ohne ungeplant dazugekommene und ohne Abwesende (#3921).
   */
  plannedStudentsCount?: number;
  /** Spontan gestartet: das Ende steht erst beim Beenden fest (#3921). */
  isSpontaneous?: boolean;
  assignedStaffIds: string[];
  isAssigned: boolean;
  isPrimary: boolean;
  isSubstitute: boolean;
  isAbsent: boolean;
  rosterPreview: TimetableRosterRow[];
  pickupTimesLoaded?: boolean;
  pickupTimesRedacted?: boolean;
  canStart?: boolean;
  startAvailableAt?: string;
  startExpiresAt?: string;
  /**
   * A finished block of the past scope the caller may reopen now (#5676):
   * ended before its planned end, reopenable until then.
   */
  canReopen?: boolean;
  /** End of that reopen window (RFC 3339), set with canReopen. */
  reopenUntil?: string;
  /**
   * Live session behind a running block (#2383) — the Tagesplan jumps to
   * /active-supervisions?session=<id>. Null unless the block is running.
   */
  activeGroupId?: string | null;
  /** Why a cancelled block does not take place (#1840). */
  cancelReason?: string | null;
  /**
   * Planned colour coding (#2383): the planning track of the block's
   * template. Only delivered in scope=day; null for blocks without a track.
   */
  planningTrackName?: string | null;
  planningTrackColor?: string | null;
  /** Education group the block's template targets (Zielgruppe). scope=day only. */
  groupName?: string | null;
  /** Assigned (non-absent) staff display names. scope=day only. */
  staffNames?: PlannedInstanceStaffName[];
  /**
   * Dienst ohne Kinder (#3822): kein Start, keine Kinderzahl, Raum optional
   * (roomId "0" = kein Raum).
   */
  isDuty?: boolean;
}

interface PlannedInstanceStaffName {
  staffId: string;
  displayName: string;
  isSubstitute: boolean;
}

interface TimetableRosterInstance {
  id: string;
  title: string;
  status: BlockStatus;
  isSpontaneous: boolean;
  activeGroupId: string | null;
  roomId: string;
  roomName?: string | null;
  date: string;
  startTime: string;
  endTime: string;
  canComplete: boolean;
  completeAvailableAt: string;
}

export interface TimetableRosterRow {
  studentId: string;
  studentName: string;
  schoolClass: string;
  groupName: string;
  planned: boolean;
  isUnplanned: boolean;
  currentlyPresent: boolean;
  visitId: string | null;
  /** undefined: a status this build does not know. */
  status: RosterRowStatus | undefined;
  /** null: none; undefined: a substatus this build does not know. */
  substatus: RosterRowSubstatus | null | undefined;
  note: string | null;
  checkedInAt: string | null;
  checkedOutAt?: string | null;
  visitEntryTime: string | null;
  /** Effective pickup time for the roster's block date. */
  pickupTime?: string | null;
  /**
   * Übergabe nach dem Unterricht (#4794): heute mit der Klasse an die OGS
   * übergeben, „da“ oder „nicht da“. Nur in der Aufsicht geliefert.
   */
  classHandover?: studentsContract.ClassHandover;
  warnings: TimetableRosterWarning[];
  /**
   * Care-plan verdict for this child on the instance's date (#1747).
   * "not_scheduled" and "cancelled" are the actionable ones: the row is set
   * apart and left out of the expected count, but stays in the list so a child
   * who turns up anyway can still be checked in with one tap. Older backends
   * omit the field, which reads as "unknown" and changes nothing. Test with
   * isCareDayExpected, never against a single value.
   */
  careDayStatus: CareDayStatus;
  /** Hinweise der Lehrkraft für den Tag des Blocks (#4795); nur mit users:read. */
  teacherHints?: studentsContract.TeacherHint[];
  /**
   * Names the other running instance where this child is currently recorded
   * present (#2265). Null when no parallel block holds the child as present;
   * older backends omit the field entirely.
   */
  parallelPresentIn?: TimetableParallelPresence | null;
  /**
   * Hausaufgaben der Klasse des Kindes am Tag des Blocks, nur in einer
   * Lernzeit (#4796). Fehlt ohne Hausaufgaben.
   */
  homework?: TimetableRosterHomework[];
  /** Rückmeldung der OGS zu diesen Hausaufgaben, falls schon gegeben. */
  homeworkFeedback?: TimetableHomeworkFeedback;
}

export type TimetableHomeworkFeedbackStatus = HomeworkFeedbackStatus;

interface TimetableRosterHomework {
  subject: string | null;
  description: string;
}

interface TimetableHomeworkFeedback {
  /** undefined: a status this build does not know. */
  status: TimetableHomeworkFeedbackStatus | undefined;
  note: string | null;
}

interface TimetableParallelPresence {
  instanceId: string;
  title: string;
  startTime: string;
  endTime: string;
}

interface TimetableRosterWarning {
  kind:
    | "arrival_after_slot_start"
    | "missing_arrival_schedule"
    | "template_class_mismatch"
    | string;
  message: string;
  expectedArrival: string | null;
  slotStart: string | null;
  expectedGroupId: string | null;
  expectedGroupName: string | null;
  currentEducationGroupId: string | null;
}

export interface TimetableRoster {
  instance: TimetableRosterInstance;
  rows: TimetableRosterRow[];
  /** False only when the bulk pickup lookup failed. */
  pickupTimesLoaded?: boolean;
  pickupTimesRedacted?: boolean;
  /**
   * Set only on check-in responses that auto-moved the child out of another
   * running session (#2386). Carries the origin's display name; an empty
   * string means the move happened but the origin has no resolvable name.
   * Null when no move happened; older backends omit the field.
   */
  movedFrom?: string | null;
  /**
   * Whether the caller may act on this block (#3167). False for staff who
   * only see it through the all_staff overview. Older backends omit it.
   */
  canOperate?: boolean;
  /** Whether the caller may start or end this block (#3622). */
  canStart?: boolean;
  canEnd?: boolean;
  /** Attendance writes do not grant lifecycle or planning authority. */
  canEditAttendance?: boolean;
  /** Sick/excused markers, separate from other block statuses. */
  canReportAbsence?: boolean;
  /**
   * Hausaufgaben-Rückmeldung (#4796): eine Lernzeit, die nicht ausfällt,
   * und das Recht, die Anwesenheit dieses Blocks einzutragen.
   */
  canRecordHomeworkFeedback?: boolean;
}

export interface StartOperationResult {
  instanceId: string;
  activeGroupId: string;
  status: string;
  startedAt?: string;
}

/** Was die Rückmeldung zu den Hausaufgaben eines Kindes schickt (#4796). */
export interface HomeworkFeedbackBody {
  status: TimetableHomeworkFeedbackStatus;
  note: string | null;
}

export interface AttendancePatchBody {
  status?: RosterRowStatus;
  substatus?: RosterRowSubstatus | null;
  note?: string | null;
}

/** An ID of the contract that may be absent; null when it is. */
function optionalId(value: string | undefined): string | null {
  return value ?? null;
}

export function mapPlannedInstance(
  raw: sharedContract.OperationPlannedInstance,
): PlannedTimetableInstance {
  return {
    id: raw.id,
    title: raw.title,
    date: raw.date,
    startTime: raw.start_time,
    endTime: raw.end_time,
    roomId: raw.room_id,
    roomName: raw.room_name ?? null,
    status: knownEnum(BLOCK_STATUS_VALUES, raw.status),
    ...(raw.activity_type === "duty" ? { isDuty: true } : {}),
    isOverdue: raw.is_overdue,
    minutesUntilStart: raw.minutes_until_start,
    expectedStudentsCount: raw.expected_students_count,
    presentStudentsCount: raw.present_students_count,
    notScheduledStudentsCount: raw.not_scheduled_students_count,
    currentStudentsCount: raw.current_students_count,
    plannedStudentsCount: raw.planned_students_count,
    ...(raw.is_spontaneous ? { isSpontaneous: true } : {}),
    assignedStaffIds: raw.assigned_staff_ids ?? [],
    isAssigned: raw.is_assigned,
    isPrimary: raw.is_primary,
    isSubstitute: raw.is_substitute,
    isAbsent: raw.is_absent,
    rosterPreview: (raw.roster_preview ?? []).map(mapRosterRow),
    pickupTimesLoaded: raw.pickup_times_loaded,
    ...(raw.pickup_times_redacted === undefined
      ? {}
      : { pickupTimesRedacted: raw.pickup_times_redacted }),
    canStart: raw.can_start,
    startAvailableAt: raw.start_available_at,
    startExpiresAt: raw.start_expires_at,
    ...(raw.can_reopen === true
      ? {
          canReopen: true,
          ...(raw.reopen_until ? { reopenUntil: raw.reopen_until } : {}),
        }
      : {}),
    activeGroupId: optionalId(raw.active_group_id),
    cancelReason: raw.cancel_reason ?? null,
    planningTrackName: raw.planning_track_name ?? null,
    planningTrackColor: raw.planning_track_color ?? null,
    groupName: raw.group_name ?? null,
    staffNames: (raw.staff_names ?? []).map((entry) => ({
      staffId: entry.staff_id,
      displayName: entry.display_name,
      isSubstitute: entry.is_substitute,
    })),
  };
}

function mapRosterRow(
  row: sharedContract.OperationRosterRow,
): TimetableRosterRow {
  return {
    studentId: row.student_id,
    studentName: row.student_name,
    schoolClass: row.school_class,
    groupName: row.group_name,
    planned: row.planned,
    isUnplanned: row.is_unplanned,
    currentlyPresent: row.currently_present,
    visitId: optionalId(row.visit_id),
    status: knownEnum(ROW_STATUS_VALUES, row.status),
    substatus:
      row.substatus === undefined
        ? null
        : knownEnum(SUBSTATUS_VALUES, row.substatus),
    note: row.note ?? null,
    checkedInAt: row.checked_in_at ?? null,
    checkedOutAt: row.checked_out_at ?? null,
    visitEntryTime: row.visit_entry_time ?? null,
    pickupTime: row.pickup_time,
    // Go's own fallback for a day the plan says nothing about
    // (backend/modules/timetable/care_days.go:19); it keeps the child expected.
    careDayStatus:
      knownEnum(CARE_DAY_STATUS_VALUES, row.care_day_status) ?? "unknown",
    ...(row.teacher_hints?.length ? { teacherHints: row.teacher_hints } : {}),
    parallelPresentIn: row.parallel_present_in
      ? {
          instanceId: row.parallel_present_in.instance_id,
          title: row.parallel_present_in.title,
          startTime: row.parallel_present_in.start_time,
          endTime: row.parallel_present_in.end_time,
        }
      : null,
    warnings: (row.warnings ?? []).map((warning) => ({
      kind: warning.kind,
      message: warning.message,
      expectedArrival: warning.expected_arrival ?? null,
      slotStart: warning.slot_start ?? null,
      expectedGroupId: optionalId(warning.expected_group_id),
      expectedGroupName: warning.expected_group_name ?? null,
      currentEducationGroupId: optionalId(warning.current_education_group_id),
    })),
    ...(row.homework && row.homework.length > 0
      ? {
          homework: row.homework.map((entry) => ({
            subject: entry.subject ?? null,
            description: entry.description,
          })),
        }
      : {}),
    ...(row.homework_feedback
      ? {
          homeworkFeedback: {
            status: knownEnum(
              HOMEWORK_FEEDBACK_STATUSES,
              row.homework_feedback.status,
            ),
            note: row.homework_feedback.note ?? null,
          },
        }
      : {}),
  };
}

export function mapRoster(
  raw: sharedContract.OperationRoster,
): TimetableRoster {
  return {
    instance: {
      id: raw.instance.id,
      title: raw.instance.title,
      status: knownEnum(BLOCK_STATUS_VALUES, raw.instance.status),
      isSpontaneous: raw.instance.is_spontaneous,
      activeGroupId: optionalId(raw.instance.active_group_id),
      roomId: raw.instance.room_id,
      roomName: raw.instance.room_name ?? null,
      date: raw.instance.date,
      startTime: raw.instance.start_time,
      endTime: raw.instance.end_time,
      canComplete: raw.instance.can_complete,
      completeAvailableAt: raw.instance.complete_available_at,
    },
    rows: (raw.rows ?? []).map(mapRosterRow),
    pickupTimesLoaded: raw.pickup_times_loaded,
    ...(raw.pickup_times_redacted === undefined
      ? {}
      : { pickupTimesRedacted: raw.pickup_times_redacted }),
    movedFrom: raw.moved_from ?? null,
    canOperate: raw.can_operate,
    canStart: raw.can_start,
    canEnd: raw.can_end,
    canEditAttendance: raw.can_edit_attendance,
    canReportAbsence: raw.can_report_absence,
    canRecordHomeworkFeedback: raw.can_record_homework_feedback,
  };
}

export function mapStartOperation(
  raw: sharedContract.startOperationResponse,
): StartOperationResult {
  return {
    instanceId: raw.instance_id,
    activeGroupId: raw.active_group_id,
    status: raw.status,
  };
}
