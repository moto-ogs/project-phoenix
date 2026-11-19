/**
 * The one mapping of the supervision projection (#2096, #7563): from the
 * contract shape the catalog proxy delivers to the camelCase view the page
 * renders. Moved here from the tests of the former BFF route; every
 * expectation of that route still holds.
 */
import { describe, expect, it } from "vitest";
import {
  buildPlannedInstanceWire,
  buildRosterRowWire,
  buildSupervisionDashboardWire,
} from "~/test/fixtures/supervision-dashboard";
import { mapSupervisionDashboard } from "~/lib/supervision-dashboard-wire";

describe("mapSupervisionDashboard", () => {
  it("maps the wire projection to the camelCase dashboard shape", () => {
    const data = mapSupervisionDashboard(
      buildSupervisionDashboardWire({
        spontaneous_start_availability: {
          available: false,
          blocked_reason: "weekend",
        },
        groups: [
          {
            id: "7",
            name: "Malen",
            room_id: "10",
            room_name: "Raum 101",
            room_color: "#83CD2D",
            is_current_user_supervising: true,
            can_assign: true,
            participant_limit: 45,
            supervisors: [
              { staff_id: "5", name: "Anna Alt" },
              { staff_id: "6", name: "Ben Bauer" },
            ],
          },
        ],
        selected_group_id: "7",
        unclaimed_groups: [{ id: "9", room_name: "Schulhof" }],
        current_staff_id: "5",
        educational_groups: [{ id: "2", name: "OGS A", room_name: "Raum 101" }],
        schulhof_status: {
          exists: true,
          room_id: "30",
          room_name: "Schulhof",
          activity_group_id: "31",
          active_group_id: "32",
          is_user_supervising: true,
          supervision_id: "33",
          supervisor_count: 1,
          student_count: 4,
          supervisors: [
            {
              id: "33",
              staff_id: "5",
              name: "Max Muster",
              is_current_user: true,
            },
          ],
        },
        capabilities: { web_spontaneous_activities_enabled: true },
        active_sessions: [
          {
            active_group_id: "7",
            instance_id: "70",
            title: "Fußball",
            start_time: "14:00",
            end_time: "15:00",
          },
        ],
        planned_now: [
          buildPlannedInstanceWire({
            id: "80",
            title: "Lernzeit",
            date: "2026-08-19",
            start_time: "15:00",
            end_time: "16:00",
            room_id: "10",
            minutes_until_start: 30,
            expected_students_count: 2,
            current_students_count: 1,
            planned_students_count: 2,
            is_spontaneous: true,
            assigned_staff_ids: ["5"],
            pickup_times_loaded: false,
            roster_preview: [
              buildRosterRowWire({ student_id: "100", pickup_time: "15:30" }),
              buildRosterRowWire({
                student_id: "101",
                student_name: "Kind Zwei",
                pickup_time: null,
              }),
            ],
          }),
        ],
        visits: [
          {
            student_id: "100",
            student_name: "Kind Eins",
            school_class: "1a",
            group_name: "OGS A",
            active_group_id: "7",
            check_in_time: "2026-08-19T10:00:00Z",
            actual_arrival_time: "12:00",
            sick: false,
            excused: false,
          },
        ],
        tracking_indicators: {
          labels: ["Hausaufgaben"],
          results: { "100": [true] },
        },
        pickup_times: [
          {
            student_id: "100",
            date: "2026-08-19",
            weekday_name: "Mittwoch",
            pickup_time: "15:30",
            is_exception: true,
            day_departure_mode: "pickup",
            day_notes: [{ id: "1", content: "Oma holt ab" }],
          },
        ],
        arrival_times: [
          {
            student_id: "100",
            date: "2026-08-19",
            weekday_name: "Mittwoch",
            expected_arrival: "11:45",
            is_exception: false,
          },
        ],
      }),
    );

    expect(data.plannedNow[0]).toMatchObject({
      currentStudentsCount: 1,
      plannedStudentsCount: 2,
      isSpontaneous: true,
    });
    expect(data.businessDay).toBe("2026-08-31");
    expect(data.spontaneousStartAvailability).toEqual({
      available: false,
      blockedReason: "weekend",
    });
    expect(data.supervisedGroups).toEqual([
      {
        id: "7",
        name: "Malen",
        canAssign: true,
        isCurrentUserSupervising: true,
        participantLimit: 45,
        supervisorNames: ["Anna Alt", "Ben Bauer"],
        room_id: "10",
        room: { id: "10", name: "Raum 101", color: "#83CD2D" },
      },
    ]);
    expect(data.unclaimedGroups[0]).toMatchObject({
      id: "9",
      room: { name: "Schulhof" },
    });
    expect(data.currentStaff).toEqual({ id: "5" });
    expect(data.educationalGroups[0]).toMatchObject({ id: "2", name: "OGS A" });
    expect(data.firstRoomVisits[0]).toMatchObject({
      studentId: "100",
      studentName: "Kind Eins",
      activeGroupId: "7",
      isActive: true,
      actualArrivalTime: "12:00",
    });
    expect(data.firstRoomId).toBe("7");
    expect(data.selectedGroupId).toBe("7");
    expect(data.schulhofStatus).toMatchObject({
      exists: true,
      activeGroupId: "32",
      supervisors: [{ staffId: "5", isCurrentUser: true }],
    });
    expect(data.capabilities?.webSpontaneousActivitiesEnabled).toBe(true);
    expect(data.activeSessions?.[0]).toMatchObject({
      activeGroupId: "7",
      title: "Fußball",
    });
    expect(data.plannedNow[0]).toMatchObject({
      pickupTimesLoaded: false,
      rosterPreview: [{ pickupTime: "15:30" }, { pickupTime: null }],
    });
    expect(data.trackingIndicators).toEqual({
      labels: ["Hausaufgaben"],
      results: { "100": [true] },
    });
    expect(data.pickupTimes?.[0]).toMatchObject({
      studentId: "100",
      pickupTime: "15:30",
      dayDepartureMode: "pickup",
      dayNotes: [{ id: "1", content: "Oma holt ab" }],
    });
    expect(data.arrivalTimes?.[0]).toMatchObject({
      studentId: "100",
      expectedArrival: "11:45",
    });
  });

  it("maps a released room's sessions with the block behind each (#3281)", () => {
    const data = mapSupervisionDashboard(
      buildSupervisionDashboardWire({
        open_rooms: [
          {
            room_id: "30",
            name: "Schulhof",
            is_user_supervising: true,
            active_group_ids: ["41", "42", "43"],
            has_occupying_session: true,
            student_count: 2,
            students: [],
            sessions: [
              {
                active_group_id: "41",
                title: "Fußball",
                independent: false,
                is_user_supervising: false,
                can_assign: false,
                student_count: 1,
                participant_limit: 45,
                supervisors: [{ staff_id: "8", name: "Cem Cakir" }],
                block: {
                  instance_id: "510",
                  start_time: "13:00",
                  end_time: "14:00",
                  is_spontaneous: true,
                  is_user_assigned: true,
                  can_operate: true,
                },
              },
              {
                active_group_id: "42",
                title: "Schulhof Freispiel",
                independent: false,
                is_user_supervising: true,
                can_assign: true,
                student_count: 0,
                block: null,
              },
              {
                active_group_id: "43",
                title: "",
                independent: true,
                is_user_supervising: false,
                can_assign: false,
                student_count: 1,
                block: null,
              },
            ],
          },
          // A room without a running session.
          {
            room_id: "31",
            name: "Sporthalle",
            is_user_supervising: false,
            active_group_ids: [],
            has_occupying_session: false,
            student_count: 0,
            students: [],
            sessions: null,
          },
        ],
      }),
    );

    expect(data.openRooms?.[0]?.sessions).toEqual([
      {
        activeGroupId: "41",
        title: "Fußball",
        independent: false,
        isUserSupervising: false,
        canAssign: false,
        studentCount: 1,
        participantLimit: 45,
        supervisorNames: ["Cem Cakir"],
        block: {
          instanceId: "510",
          startTime: "13:00",
          endTime: "14:00",
          isSpontaneous: true,
          isUserAssigned: true,
          canOperate: true,
        },
      },
      {
        activeGroupId: "42",
        title: "Schulhof Freispiel",
        independent: false,
        isUserSupervising: true,
        canAssign: true,
        studentCount: 0,
        participantLimit: null,
        supervisorNames: [],
        block: null,
      },
      {
        activeGroupId: "43",
        title: "",
        independent: true,
        isUserSupervising: false,
        canAssign: false,
        studentCount: 1,
        participantLimit: null,
        supervisorNames: [],
        block: null,
      },
    ]);
    expect(data.openRooms?.[1]?.sessions).toEqual([]);
  });

  // A released room lists activity children and independent stays together
  // (#3066). Only the backend's explicit flag marks a stay as independent.
  it("maps released-room children with their independent-stay flag", () => {
    const openRoomStudent = {
      school_class: "2a",
      group_name: "OGS A",
      check_in_time: "2026-09-09T10:00:00.000Z",
      sick: false,
      excused: false,
    };
    const data = mapSupervisionDashboard(
      buildSupervisionDashboardWire({
        open_rooms: [
          {
            room_id: "10",
            name: "Sporthalle",
            is_user_supervising: false,
            active_group_ids: ["21", "23"],
            has_occupying_session: false,
            student_count: 3,
            sessions: [],
            students: [
              {
                ...openRoomStudent,
                student_id: "1",
                student_name: "Klara Kick",
                active_group_id: "21",
                activity_name: "Fußball",
                independent: false,
              },
              {
                ...openRoomStudent,
                student_id: "2",
                student_name: "Ida Eigen",
                active_group_id: "23",
                independent: true,
              },
              {
                ...openRoomStudent,
                student_id: "3",
                student_name: "Otto Alt",
                active_group_id: "21",
                activity_name: "Fußball",
                independent: false,
              },
            ],
          },
        ],
      }),
    );

    expect(data.openRooms?.[0]?.students).toEqual([
      expect.objectContaining({
        studentId: "1",
        activityName: "Fußball",
        independent: false,
      }),
      expect.objectContaining({ studentId: "2", independent: true }),
      expect.objectContaining({
        studentId: "3",
        activityName: "Fußball",
        independent: false,
      }),
    ]);
    expect(data.openRooms?.[0]?.students[1]?.activityName).toBeUndefined();
  });

  it("passes the planning-track colour of a planned block through (#4413)", () => {
    const data = mapSupervisionDashboard(
      buildSupervisionDashboardWire({
        planned_now: [
          buildPlannedInstanceWire({ planning_track_color: "#5080D8" }),
          buildPlannedInstanceWire({ id: "8" }),
        ],
      }),
    );

    expect(data.plannedNow[0]?.planningTrackColor).toBe("#5080D8");
    expect(data.plannedNow[1]?.planningTrackColor).toBeNull();
  });
});
