import { describe, expect, it } from "vitest";
import type {
  OperationRoster,
  startOperationResponse,
} from "./contract/shared.generated";
import {
  mapPlannedInstance,
  mapRoster,
  mapStartOperation,
} from "./timetable-operations-types";
import {
  buildOperationPlannedInstance as plannedInstance,
  buildOperationRoster as roster,
  buildOperationRosterInstance as rosterInstance,
  buildOperationRosterRow as rosterRow,
} from "~/test/fixtures/timetable-operations";

describe("timetable operation mappers", () => {
  it("maps the caller's action rights as Go sends them", () => {
    const base = roster({
      instance: rosterInstance({ id: "117", status: "active" }),
    });

    expect(mapRoster({ ...base, can_operate: false }).canOperate).toBe(false);
    expect(mapRoster({ ...base, can_operate: true }).canOperate).toBe(true);
    expect(
      mapRoster({
        ...base,
        can_operate: false,
        can_edit_attendance: true,
        can_report_absence: false,
      }),
    ).toMatchObject({
      canOperate: false,
      canEditAttendance: true,
      canReportAbsence: false,
    });
    expect(mapRoster({ ...base, can_start: true }).canStart).toBe(true);
    expect(mapRoster({ ...base, can_start: false }).canStart).toBe(false);
    expect(mapRoster({ ...base, can_end: false }).canEnd).toBe(false);
    expect(
      mapRoster({ ...base, can_record_homework_feedback: false })
        .canRecordHomeworkFeedback,
    ).toBe(false);
  });

  it("keeps loaded pickup times distinct from a failed pickup lookup", () => {
    const loaded = mapRoster(
      roster({
        instance: rosterInstance({ id: "119", title: "Randstunde" }),
        pickup_times_loaded: true,
        rows: [
          rosterRow({
            student_id: "419",
            student_name: "Mara Montag",
            pickup_time: "13:30",
          }),
        ],
      }),
    );
    const failed = mapRoster(
      roster({
        instance: rosterInstance({ id: "118", status: "active" }),
        pickup_times_loaded: false,
        pickup_times_redacted: true,
        rows: [
          rosterRow({
            student_id: "418",
            student_name: "Nora Nichtgeladen",
            pickup_time: null,
          }),
        ],
      }),
    );

    expect(loaded.pickupTimesLoaded).toBe(true);
    expect(loaded.rows[0]!.pickupTime).toBe("13:30");
    expect(failed.pickupTimesLoaded).toBe(false);
    expect(failed.pickupTimesRedacted).toBe(true);
    expect(failed.rows[0]!.pickupTime).toBeNull();
  });

  it("maps planned instances from backend snake_case into frontend camelCase", () => {
    const result = mapPlannedInstance(
      plannedInstance({
        id: "120",
        title: "Lernzeit",
        date: "2026-05-10",
        start_time: "14:00",
        end_time: "15:00",
        room_id: "220",
        room_name: "Lernraum",
        status: "planned",
        is_overdue: true,
        minutes_until_start: -5,
        expected_students_count: 18,
        present_students_count: 3,
        current_students_count: 2,
        planned_students_count: 17,
        assigned_staff_ids: ["320", "321"],
        is_assigned: true,
        is_primary: true,
        active_group_id: "910",
        planning_track_name: "Angebote",
        planning_track_color: "#5080D8",
        group_name: "Gruppe Sonne",
        staff_names: [
          {
            staff_id: "320",
            display_name: "Maria Muster",
            is_substitute: false,
          },
          {
            staff_id: "321",
            display_name: "Vera Vertretung",
            is_substitute: true,
          },
        ],
        roster_preview: [
          rosterRow({
            student_id: "420",
            student_name: "Mila Muster",
            school_class: "3a",
            group_name: "OGS Blau",
            care_day_status: "unknown",
          }),
        ],
      }),
    );

    expect(result).toEqual({
      id: "120",
      title: "Lernzeit",
      date: "2026-05-10",
      startTime: "14:00",
      endTime: "15:00",
      roomId: "220",
      roomName: "Lernraum",
      status: "planned",
      isOverdue: true,
      minutesUntilStart: -5,
      expectedStudentsCount: 18,
      notScheduledStudentsCount: 0,
      presentStudentsCount: 3,
      currentStudentsCount: 2,
      plannedStudentsCount: 17,
      assignedStaffIds: ["320", "321"],
      isAssigned: true,
      isPrimary: true,
      isSubstitute: false,
      isAbsent: false,
      pickupTimesLoaded: true,
      canStart: false,
      startAvailableAt: "",
      startExpiresAt: "",
      activeGroupId: "910",
      cancelReason: null,
      planningTrackName: "Angebote",
      planningTrackColor: "#5080D8",
      groupName: "Gruppe Sonne",
      staffNames: [
        { staffId: "320", displayName: "Maria Muster", isSubstitute: false },
        { staffId: "321", displayName: "Vera Vertretung", isSubstitute: true },
      ],
      rosterPreview: [
        {
          studentId: "420",
          studentName: "Mila Muster",
          schoolClass: "3a",
          groupName: "OGS Blau",
          planned: true,
          isUnplanned: false,
          currentlyPresent: false,
          visitId: null,
          status: "expected",
          substatus: null,
          note: null,
          checkedInAt: null,
          checkedOutAt: null,
          parallelPresentIn: null,
          visitEntryTime: null,
          pickupTime: null,
          warnings: [],
          careDayStatus: "unknown",
        },
      ],
    });
  });

  it("maps roster ids and optional fields without leaking undefined", () => {
    const raw: OperationRoster = roster({
      instance: rosterInstance({
        id: "121",
        title: "AG Kunst",
        status: "active",
        is_spontaneous: true,
        active_group_id: "221",
        room_id: "222",
        date: "2026-05-10",
        start_time: "14:00",
        end_time: "15:00",
      }),
      rows: [
        rosterRow({
          student_id: "420",
          student_name: "Mila Muster",
          school_class: "3a",
          group_name: "OGS Blau",
          currently_present: true,
          visit_id: "520",
          status: "present",
          substatus: "late",
          note: "kam nach",
          checked_in_at: "2026-05-10T12:00:00Z",
          checked_out_at: "2026-05-10T13:00:00Z",
          visit_entry_time: "2026-05-10T12:01:00Z",
          care_day_status: "unknown",
        }),
        rosterRow({
          student_id: "421",
          student_name: "Ben Beispiel",
          school_class: "4b",
          planned: false,
          is_unplanned: true,
          care_day_status: "unknown",
        }),
      ],
    });

    expect(mapRoster(raw)).toEqual({
      instance: {
        id: "121",
        title: "AG Kunst",
        status: "active",
        isSpontaneous: true,
        activeGroupId: "221",
        roomId: "222",
        roomName: null,
        date: "2026-05-10",
        startTime: "14:00",
        endTime: "15:00",
        canComplete: false,
        completeAvailableAt: "",
      },
      rows: [
        {
          studentId: "420",
          studentName: "Mila Muster",
          schoolClass: "3a",
          groupName: "OGS Blau",
          planned: true,
          isUnplanned: false,
          currentlyPresent: true,
          visitId: "520",
          status: "present",
          substatus: "late",
          note: "kam nach",
          checkedInAt: "2026-05-10T12:00:00Z",
          checkedOutAt: "2026-05-10T13:00:00Z",
          visitEntryTime: "2026-05-10T12:01:00Z",
          pickupTime: null,
          warnings: [],
          careDayStatus: "unknown",
          parallelPresentIn: null,
        },
        {
          studentId: "421",
          studentName: "Ben Beispiel",
          schoolClass: "4b",
          groupName: "",
          planned: false,
          isUnplanned: true,
          currentlyPresent: false,
          visitId: null,
          status: "expected",
          substatus: null,
          note: null,
          checkedInAt: null,
          checkedOutAt: null,
          parallelPresentIn: null,
          visitEntryTime: null,
          pickupTime: null,
          warnings: [],
          careDayStatus: "unknown",
        },
      ],
      pickupTimesLoaded: true,
      movedFrom: null,
      canOperate: true,
      canStart: true,
      canEnd: true,
      canEditAttendance: true,
      canReportAbsence: true,
      canRecordHomeworkFeedback: false,
    });
  });

  it("marks a duty from activity_type (#3822)", () => {
    const base = plannedInstance({
      id: "125",
      title: "Busaufsicht",
      room_id: "0",
      minutes_until_start: 30,
    });
    expect(mapPlannedInstance({ ...base, activity_type: "duty" }).isDuty).toBe(
      true,
    );
    expect(
      mapPlannedInstance({ ...base, activity_type: "care" }).isDuty,
    ).toBeUndefined();
  });

  it("maps the reopen offer of a finished block (#5676)", () => {
    const base = plannedInstance({
      id: "125",
      title: "GT 4",
      status: "completed",
      is_overdue: true,
      minutes_until_start: -45,
    });

    const offered = mapPlannedInstance({
      ...base,
      can_reopen: true,
      reopen_until: "2026-05-11T14:00:00Z",
    });
    expect(offered.canReopen).toBe(true);
    expect(offered.reopenUntil).toBe("2026-05-11T14:00:00Z");

    const closed = mapPlannedInstance(base);
    expect(closed.canReopen).toBeUndefined();
    expect(closed.reopenUntil).toBeUndefined();
  });

  it("maps planned instance defaults when backend omits optional fields and preview", () => {
    const result = mapPlannedInstance(
      plannedInstance({
        id: "124",
        title: "Freispiel",
        date: "2026-05-11",
        start_time: "15:00",
        end_time: "16:00",
        room_id: "225",
        minutes_until_start: 30,
        assigned_staff_ids: null,
      }),
    );

    expect(result).toEqual({
      id: "124",
      title: "Freispiel",
      date: "2026-05-11",
      startTime: "15:00",
      endTime: "16:00",
      roomId: "225",
      roomName: null,
      status: "planned",
      isOverdue: false,
      minutesUntilStart: 30,
      expectedStudentsCount: 0,
      notScheduledStudentsCount: 0,
      presentStudentsCount: 0,
      currentStudentsCount: 0,
      plannedStudentsCount: 0,
      assignedStaffIds: [],
      isAssigned: false,
      isPrimary: false,
      isSubstitute: false,
      isAbsent: false,
      pickupTimesLoaded: true,
      canStart: false,
      startAvailableAt: "",
      startExpiresAt: "",
      activeGroupId: null,
      cancelReason: null,
      planningTrackName: null,
      planningTrackColor: null,
      groupName: null,
      staffNames: [],
      rosterPreview: [],
    });
  });

  it("maps roster warnings and normalizes omitted warning ids", () => {
    const raw = roster({
      instance: rosterInstance({ id: "125", status: "active" }),
      rows: [
        rosterRow({
          student_id: "423",
          student_name: "Warn Kind",
          warnings: [
            {
              kind: "arrival_after_slot_start",
              message: "zu spät",
              expected_arrival: "14:30",
              slot_start: "14:00",
              expected_group_id: "700",
              expected_group_name: "Klasse 3d",
              current_education_group_id: "701",
            },
            { kind: "missing_arrival_schedule", message: "kein Plan" },
          ],
        }),
      ],
    });

    expect(mapRoster(raw).rows[0]!.warnings).toEqual([
      {
        kind: "arrival_after_slot_start",
        message: "zu spät",
        expectedArrival: "14:30",
        slotStart: "14:00",
        expectedGroupId: "700",
        expectedGroupName: "Klasse 3d",
        currentEducationGroupId: "701",
      },
      {
        kind: "missing_arrival_schedule",
        message: "kein Plan",
        expectedArrival: null,
        slotStart: null,
        expectedGroupId: null,
        expectedGroupName: null,
        currentEducationGroupId: null,
      },
    ]);
  });

  it("maps omitted roster instance fields to null", () => {
    const mapped = mapRoster(
      roster({
        instance: rosterInstance({
          id: "123",
          title: "Spätbetreuung",
          room_id: "224",
          room_name: "Raum B",
        }),
        rows: null,
      }),
    );

    expect(mapped.instance).toMatchObject({
      id: "123",
      activeGroupId: null,
      isSpontaneous: false,
      roomId: "224",
      roomName: "Raum B",
    });
    expect(mapped.rows).toEqual([]);
    expect(mapped.movedFrom).toBeNull();
  });

  it("maps start operation ids", () => {
    const raw: startOperationResponse = {
      instance_id: "122",
      active_group_id: "223",
      status: "active",
      warnings: null,
    };

    expect(mapStartOperation(raw)).toEqual({
      instanceId: "122",
      activeGroupId: "223",
      status: "active",
    });
  });

  it("leaves a status this build does not know undefined", () => {
    const mapped = mapRoster(
      roster({
        instance: rosterInstance({ status: "paused" }),
        rows: [
          rosterRow({
            status: "away",
            substatus: "hospital",
            care_day_status: "half_day",
            homework_feedback: { status: "partly" },
          }),
        ],
      }),
    );

    expect(mapped.instance.status).toBeUndefined();
    expect(mapped.rows[0]).toMatchObject({
      status: undefined,
      substatus: undefined,
      careDayStatus: "unknown",
      homeworkFeedback: { status: undefined, note: null },
    });
    expect(
      mapPlannedInstance(plannedInstance({ status: "paused" })).status,
    ).toBeUndefined();
  });
});

describe("Lernzeit homework on the roster (#4796)", () => {
  const instance = rosterInstance({
    id: "1",
    title: "Lernzeit",
    status: "active",
  });
  const studentRow = rosterRow({
    student_id: "7",
    student_name: "Mia Beispiel",
    currently_present: true,
    status: "present",
  });

  it("maps homework, feedback and the verdict, and leaves them out when absent", () => {
    const mapped = mapRoster(
      roster({
        instance,
        can_record_homework_feedback: true,
        rows: [
          {
            ...studentRow,
            homework: [{ description: "Lesen" }],
            homework_feedback: { status: "not_done" },
          },
        ],
      }),
    );
    expect(mapped.canRecordHomeworkFeedback).toBe(true);
    expect(mapped.rows[0]?.homework).toEqual([
      { subject: null, description: "Lesen" },
    ]);
    expect(mapped.rows[0]?.homeworkFeedback).toEqual({
      status: "not_done",
      note: null,
    });

    const plain = mapRoster(roster({ instance, rows: [studentRow] }));
    expect(plain).toHaveProperty("rows.0.studentId", "7");
    expect(plain.canRecordHomeworkFeedback).toBe(false);
    expect(plain.rows[0]).not.toHaveProperty("homework");
    expect(plain.rows[0]).not.toHaveProperty("homeworkFeedback");
  });
});
