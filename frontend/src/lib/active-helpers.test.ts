import { describe, it, expect } from "vitest";
import {
  mapActiveGroupResponse,
  mapVisitResponse,
  mapSupervisorResponse,
  mapSchulhofStatusResponse,
} from "./active-helpers";
import {
  buildBackendActiveSession,
  buildBackendVisit,
  buildBackendSupervisor,
} from "~/test/fixtures/sessions";
import type * as activeContract from "~/lib/contract/active.generated";

// Decoded responses of the catalog proxy: identifiers arrive as strings.
const sampleBackendActiveGroup = buildBackendActiveSession({
  id: "1",
  group_id: "10",
  room_id: "5",
  start_time: "2024-01-15T08:00:00Z",
  end_time: "2024-01-15T12:00:00Z",
  is_active: true,
  visit_count: 25,
  supervisor_count: 2,
  room: { id: "5", name: "Room A", color: "#5080D8" },
});

const sampleBackendVisit = buildBackendVisit({
  id: "100",
  student_id: "50",
  active_group_id: "1",
  check_in_time: "2024-01-15T08:30:00Z",
  check_out_time: "2024-01-15T11:45:00Z",
  is_active: false,
  student_name: "Max Mustermann",
  active_group_name: "Morning Session",
});

const sampleBackendSupervisor = buildBackendSupervisor({
  id: "200",
  staff_id: "30",
  active_group_id: "1",
  start_time: "2024-01-15T08:00:00Z",
  end_time: "2024-01-15T12:00:00Z",
  is_active: true,
  staff_name: "Frau Schmidt",
  active_group_name: "Morning Session",
});

describe("active-helpers", () => {
  describe("mapActiveGroupResponse", () => {
    it("maps all fields correctly from backend to frontend format", () => {
      const result = mapActiveGroupResponse(sampleBackendActiveGroup);

      expect(result.id).toBe("1");
      expect(result.groupId).toBe("10");
      expect(result.roomId).toBe("5");
      expect(result.startTime).toEqual(new Date("2024-01-15T08:00:00Z"));
      expect(result.endTime).toEqual(new Date("2024-01-15T12:00:00Z"));
      expect(result.isActive).toBe(true);
      expect(result.visitCount).toBe(25);
      expect(result.supervisorCount).toBe(2);
      expect(result.room).toEqual({
        id: "5",
        name: "Room A",
        color: "#5080D8",
      });
      expect(result.createdAt).toEqual(new Date("2024-01-01T00:00:00Z"));
      expect(result.updatedAt).toEqual(new Date("2024-01-15T08:00:00Z"));
    });

    it("handles undefined optional fields", () => {
      const minimalGroup: activeContract.ActiveGroupResponse = {
        id: "1",
        group_id: "10",
        room_id: "5",
        start_time: "2024-01-15T08:00:00Z",
        is_active: true,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-15T08:00:00Z",
      };

      const result = mapActiveGroupResponse(minimalGroup);

      expect(result.endTime).toBeUndefined();
      expect(result.visitCount).toBeUndefined();
      expect(result.supervisorCount).toBeUndefined();
      expect(result.room).toBeUndefined();
    });

    // A spontaneous session has no parent template (WP-B6).
    it("keeps a null group_id as null", () => {
      const result = mapActiveGroupResponse(
        buildBackendActiveSession({ group_id: null }),
      );

      expect(result.groupId).toBeNull();
    });
  });

  describe("mapVisitResponse", () => {
    it("maps all fields correctly from backend to frontend format", () => {
      const result = mapVisitResponse(sampleBackendVisit);

      expect(result.id).toBe("100");
      expect(result.studentId).toBe("50");
      expect(result.activeGroupId).toBe("1");
      expect(result.checkInTime).toEqual(new Date("2024-01-15T08:30:00Z"));
      expect(result.checkOutTime).toEqual(new Date("2024-01-15T11:45:00Z"));
      expect(result.isActive).toBe(false);
      expect(result.studentName).toBe("Max Mustermann");
      expect(result.activeGroupName).toBe("Morning Session");
    });

    it("handles undefined optional fields", () => {
      const minimalVisit: activeContract.VisitResponse = {
        id: "100",
        student_id: "50",
        active_group_id: "1",
        check_in_time: "2024-01-15T08:30:00Z",
        is_active: true,
        created_at: "2024-01-15T08:30:00Z",
        updated_at: "2024-01-15T08:30:00Z",
      };

      const result = mapVisitResponse(minimalVisit);

      expect(result.checkOutTime).toBeUndefined();
      expect(result.studentName).toBeUndefined();
      expect(result.activeGroupName).toBeUndefined();
    });
  });

  describe("mapSupervisorResponse", () => {
    it("maps all fields correctly from backend to frontend format", () => {
      const result = mapSupervisorResponse(sampleBackendSupervisor);

      expect(result.id).toBe("200");
      expect(result.staffId).toBe("30");
      expect(result.activeGroupId).toBe("1");
      expect(result.startTime).toEqual(new Date("2024-01-15T08:00:00Z"));
      expect(result.endTime).toEqual(new Date("2024-01-15T12:00:00Z"));
      expect(result.isActive).toBe(true);
      expect(result.staffName).toBe("Frau Schmidt");
      expect(result.activeGroupName).toBe("Morning Session");
    });

    it("handles undefined optional fields", () => {
      const minimalSupervisor: activeContract.SupervisorResponse = {
        id: "200",
        staff_id: "30",
        active_group_id: "1",
        start_time: "2024-01-15T08:00:00Z",
        is_active: true,
        created_at: "2024-01-15T08:00:00Z",
        updated_at: "2024-01-15T08:00:00Z",
      };

      const result = mapSupervisorResponse(minimalSupervisor);

      expect(result.endTime).toBeUndefined();
      expect(result.staffName).toBeUndefined();
      expect(result.activeGroupName).toBeUndefined();
    });
  });

  describe("mapSchulhofStatusResponse", () => {
    it("maps all fields correctly with complete data", () => {
      const backendStatus: activeContract.SchulhofStatusResponse = {
        exists: true,
        room_id: "42",
        room_name: "Schulhof",
        activity_group_id: "10",
        active_group_id: "5",
        is_user_supervising: true,
        supervision_id: "123",
        supervisor_count: 3,
        student_count: 25,
        supervisors: [
          {
            id: "1",
            staff_id: "100",
            name: "Frau Schmidt",
            is_current_user: true,
          },
          {
            id: "2",
            staff_id: "101",
            name: "Herr Müller",
            is_current_user: false,
          },
        ],
      };

      const result = mapSchulhofStatusResponse(backendStatus);

      expect(result.exists).toBe(true);
      expect(result.roomId).toBe("42");
      expect(result.roomName).toBe("Schulhof");
      expect(result.activityGroupId).toBe("10");
      expect(result.activeGroupId).toBe("5");
      expect(result.isUserSupervising).toBe(true);
      expect(result.supervisionId).toBe("123");
      expect(result.supervisorCount).toBe(3);
      expect(result.studentCount).toBe(25);
      expect(result.supervisors).toHaveLength(2);
      expect(result.supervisors[0]).toEqual({
        id: "1",
        staffId: "100",
        name: "Frau Schmidt",
        isCurrentUser: true,
      });
      expect(result.supervisors[1]).toEqual({
        id: "2",
        staffId: "101",
        name: "Herr Müller",
        isCurrentUser: false,
      });
    });

    it("handles non-existent Schulhof with minimal data", () => {
      const backendStatus: activeContract.SchulhofStatusResponse = {
        exists: false,
        room_name: "",
        is_user_supervising: false,
        supervisor_count: 0,
        student_count: 0,
        supervisors: [],
      };

      const result = mapSchulhofStatusResponse(backendStatus);

      expect(result.exists).toBe(false);
      expect(result.roomId).toBeNull();
      expect(result.roomName).toBe("");
      expect(result.activityGroupId).toBeNull();
      expect(result.activeGroupId).toBeNull();
      expect(result.isUserSupervising).toBe(false);
      expect(result.supervisionId).toBeNull();
      expect(result.supervisorCount).toBe(0);
      expect(result.studentCount).toBe(0);
      expect(result.supervisors).toEqual([]);
    });

    it("handles undefined optional fields as null", () => {
      const backendStatus: activeContract.SchulhofStatusResponse = {
        exists: true,
        room_name: "Schulhof",
        is_user_supervising: false,
        supervisor_count: 0,
        student_count: 0,
        supervisors: [],
        // room_id, activity_group_id, active_group_id, supervision_id are undefined
      };

      const result = mapSchulhofStatusResponse(backendStatus);

      expect(result.roomId).toBeNull();
      expect(result.activityGroupId).toBeNull();
      expect(result.activeGroupId).toBeNull();
      expect(result.supervisionId).toBeNull();
    });

    // The contract allows a null list; Go sends [] (#2353).
    it("reads a null supervisor list as empty", () => {
      const result = mapSchulhofStatusResponse({
        exists: true,
        room_name: "Schulhof",
        is_user_supervising: false,
        supervisor_count: 0,
        student_count: 0,
        supervisors: null,
      });

      expect(result.supervisors).toEqual([]);
    });

    it("maps supervisor array correctly", () => {
      const backendStatus: activeContract.SchulhofStatusResponse = {
        exists: true,
        room_name: "Schulhof",
        is_user_supervising: false,
        supervisor_count: 2,
        student_count: 0,
        supervisors: [
          {
            id: "1",
            staff_id: "10",
            name: "Supervisor One",
            is_current_user: false,
          },
          {
            id: "2",
            staff_id: "20",
            name: "Supervisor Two",
            is_current_user: true,
          },
        ],
      };

      const result = mapSchulhofStatusResponse(backendStatus);

      expect(result.supervisors).toHaveLength(2);
      expect(result.supervisors[0]?.isCurrentUser).toBe(false);
      expect(result.supervisors[1]?.isCurrentUser).toBe(true);
    });

    it("handles empty supervisors array", () => {
      const backendStatus: activeContract.SchulhofStatusResponse = {
        exists: true,
        room_name: "Schulhof",
        is_user_supervising: false,
        supervisor_count: 0,
        student_count: 0,
        supervisors: [],
      };

      const result = mapSchulhofStatusResponse(backendStatus);

      expect(result.supervisors).toEqual([]);
      expect(result.supervisorCount).toBe(0);
    });
  });
});
