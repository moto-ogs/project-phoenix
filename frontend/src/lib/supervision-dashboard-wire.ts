// The one mapping of the supervision projection (#2096, #7563): from the
// contract's shape of GET /api/active/supervision-dashboard, as the catalog
// proxy decodes it (identifiers already strings), to the camelCase view the
// page renders. Pure.
import type {
  OpenRoomStudent,
  DashboardProjection,
  SessionSupervisor,
  Visit,
} from "~/lib/contract/active.generated";
import type { DepartureMode } from "~/lib/departure-plan";
import { studentPhotoHref } from "~/lib/student-photo-href";
import type { CareDayStatus } from "~/lib/timetable-types";
import type { PlannedTimetableInstance } from "~/lib/timetable-operations-types";

type RosterRow = PlannedTimetableInstance["rosterPreview"][number];

// A visit as the page renders it — the same shape for a session roster and
// for a released room's occupancy. `isActive` is a constant here: the backend
// only ever ships open visits in these sections.
function toSupervisionVisit(v: Visit | OpenRoomStudent) {
  return {
    studentId: v.student_id,
    studentName: v.student_name,
    schoolClass: v.school_class,
    groupName: v.group_name,
    activeGroupId: v.active_group_id,
    checkInTime: v.check_in_time,
    actualArrivalTime: v.actual_arrival_time,
    actualPickupTime: v.actual_pickup_time,
    isActive: true,
    sick: v.sick,
    sickSince: v.sick_since,
    excused: v.excused,
    excusedSince: v.excused_since,
    classHandover: v.class_handover,
    photoUrl: v.photo_version
      ? studentPhotoHref(v.student_id, v.photo_version)
      : undefined,
  };
}

function supervisorNames(
  supervisors: SessionSupervisor[] | undefined,
): string[] {
  return (supervisors ?? []).map((supervisor) => supervisor.name);
}

export function mapSupervisionDashboard(wire: DashboardProjection) {
  const schulhof = wire.schulhof_status;
  return {
    businessDay: wire.business_day,
    spontaneousStartAvailability: {
      available: wire.spontaneous_start_availability.available,
      blockedReason: wire.spontaneous_start_availability.blocked_reason as
        "weekend" | undefined,
    },
    supervisedGroups: (wire.groups ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      canAssign: g.can_assign,
      isCurrentUserSupervising: g.is_current_user_supervising,
      participantLimit: g.participant_limit ?? null,
      supervisorNames: supervisorNames(g.supervisors),
      room_id: g.room_id,
      room: g.room_id
        ? {
            id: g.room_id,
            name: g.room_name ?? "",
            color: g.room_color ?? null,
          }
        : undefined,
    })),
    unclaimedGroups: (wire.unclaimed_groups ?? []).map((g) => ({
      id: g.id,
      name: "",
      room: g.room_name ? { name: g.room_name } : undefined,
    })),
    currentStaff: wire.current_staff_id ? { id: wire.current_staff_id } : null,
    educationalGroups: (wire.educational_groups ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      room: g.room_name ? { name: g.room_name } : undefined,
    })),
    firstRoomVisits: (wire.visits ?? []).map(toSupervisionVisit),
    firstRoomId: wire.selected_group_id ?? null,
    openRooms: (wire.open_rooms ?? []).map((room) => ({
      roomId: room.room_id,
      name: room.name,
      isUserSupervising: room.is_user_supervising,
      activeGroupIds: room.active_group_ids ?? [],
      hasOccupyingSession: room.has_occupying_session,
      studentCount: room.student_count,
      students: (room.students ?? []).map((student) => ({
        ...toSupervisionVisit(student),
        activityName: student.activity_name,
        independent: student.independent,
      })),
      sessions: (room.sessions ?? []).map((session) => ({
        activeGroupId: session.active_group_id,
        title: session.title,
        independent: session.independent,
        isUserSupervising: session.is_user_supervising,
        canAssign: session.can_assign,
        studentCount: session.student_count,
        participantLimit: session.participant_limit ?? null,
        supervisorNames: supervisorNames(session.supervisors),
        block: session.block
          ? {
              instanceId: session.block.instance_id,
              startTime: session.block.start_time,
              endTime: session.block.end_time,
              isSpontaneous: session.block.is_spontaneous,
              isUserAssigned: session.block.is_user_assigned,
              canOperate: session.block.can_operate,
            }
          : null,
      })),
    })),
    schulhofStatus: schulhof
      ? {
          exists: schulhof.exists,
          roomId: schulhof.room_id ?? null,
          roomName: schulhof.room_name,
          activityGroupId: schulhof.activity_group_id ?? null,
          activeGroupId: schulhof.active_group_id ?? null,
          isUserSupervising: schulhof.is_user_supervising,
          supervisionId: schulhof.supervision_id ?? null,
          supervisorCount: schulhof.supervisor_count,
          studentCount: schulhof.student_count,
          supervisors: (schulhof.supervisors ?? []).map((s) => ({
            id: s.id,
            staffId: s.staff_id,
            name: s.name,
            isCurrentUser: s.is_current_user,
          })),
        }
      : null,
    capabilities: {
      webSpontaneousActivitiesEnabled:
        wire.capabilities.web_spontaneous_activities_enabled,
    },
    activeSessions: (wire.active_sessions ?? []).map((s) => ({
      activeGroupId: s.active_group_id,
      instanceId: s.instance_id,
      title: s.title,
      startTime: s.start_time,
      endTime: s.end_time,
    })),
    plannedNow: (wire.planned_now ?? []).map((i) => ({
      id: i.id,
      title: i.title,
      date: i.date,
      startTime: i.start_time,
      endTime: i.end_time,
      roomId: i.room_id,
      roomName: i.room_name ?? null,
      status: i.status as PlannedTimetableInstance["status"],
      isOverdue: i.is_overdue,
      minutesUntilStart: i.minutes_until_start,
      expectedStudentsCount: i.expected_students_count,
      presentStudentsCount: i.present_students_count,
      notScheduledStudentsCount: i.not_scheduled_students_count,
      currentStudentsCount: i.current_students_count,
      plannedStudentsCount: i.planned_students_count,
      isSpontaneous: i.is_spontaneous,
      assignedStaffIds: i.assigned_staff_ids ?? [],
      isAssigned: i.is_assigned,
      isPrimary: i.is_primary,
      isSubstitute: i.is_substitute,
      isAbsent: i.is_absent,
      canStart: i.can_start,
      startAvailableAt: i.start_available_at,
      startExpiresAt: i.start_expires_at,
      pickupTimesLoaded: i.pickup_times_loaded,
      pickupTimesRedacted: i.pickup_times_redacted,
      planningTrackColor: i.planning_track_color ?? null,
      rosterPreview: (i.roster_preview ?? []).map((row): RosterRow => ({
        studentId: row.student_id,
        studentName: row.student_name,
        schoolClass: row.school_class,
        groupName: row.group_name,
        planned: row.planned,
        isUnplanned: row.is_unplanned,
        currentlyPresent: row.currently_present,
        visitId: row.visit_id ?? null,
        status: row.status as RosterRow["status"],
        substatus: (row.substatus ?? null) as RosterRow["substatus"],
        note: row.note ?? null,
        checkedInAt: row.checked_in_at ?? null,
        visitEntryTime: row.visit_entry_time ?? null,
        pickupTime: row.pickup_time,
        classHandover: row.class_handover,
        careDayStatus: row.care_day_status as CareDayStatus,
        warnings: (row.warnings ?? []).map((warning) => ({
          kind: warning.kind,
          message: warning.message,
          expectedArrival: warning.expected_arrival ?? null,
          slotStart: warning.slot_start ?? null,
          expectedGroupId: warning.expected_group_id ?? null,
          expectedGroupName: warning.expected_group_name ?? null,
          currentEducationGroupId: warning.current_education_group_id ?? null,
        })),
      })),
    })),
    selectedGroupId: wire.selected_group_id ?? null,
    trackingIndicators: {
      labels: wire.tracking_indicators.labels ?? [],
      results: (wire.tracking_indicators.results ?? {}) as Record<
        string,
        boolean[]
      >,
    },
    pickupTimes: (wire.pickup_times ?? []).map((p) => ({
      studentId: p.student_id,
      date: p.date,
      weekdayName: p.weekday_name,
      pickupTime: p.pickup_time ?? null,
      isException: p.is_exception,
      dayDepartureMode: p.day_departure_mode as DepartureMode | undefined,
      notes: p.notes ?? "",
      dayNotes: (p.day_notes ?? []).map((n) => ({
        id: n.id,
        content: n.content,
      })),
    })),
    teacherHints: (wire.teacher_hints ?? []).map((hint) => ({
      studentId: hint.student_id,
      body: hint.body,
      author_name: hint.author_name,
      school_class: hint.school_class,
    })),
    arrivalTimes: (wire.arrival_times ?? []).map((a) => ({
      studentId: a.student_id,
      date: a.date,
      weekdayName: a.weekday_name,
      expectedArrival: a.expected_arrival ?? null,
      isException: a.is_exception,
      notes: a.notes ?? "",
      dayNotes: (a.day_notes ?? []).map((n) => ({
        id: n.id,
        content: n.content,
      })),
    })),
  };
}
