import { describe, it, expect } from "vitest";
import type {
  BackendStudentEnrollment,
  Activity,
  ActivitySupervisor,
} from "./activity-helpers";
import {
  formatSupervisorList,
  mapActivityResponse,
  mapActivityCategoryResponse,
  mapStudentEnrollmentResponse,
  mapStudentEnrollmentsResponse,
  isActivityCreator,
  mapSupervisorOption,
  readActivity,
  readActivityCategory,
  isSystemActivity,
} from "./activity-helpers";
import type {
  ActivityCategoryResponse,
  ActivityResponse,
  ActivitySupervisorResponse,
} from "./contract/activities.generated";

// Sample data for tests, in the contract's shape
const sampleBackendSupervisor: ActivitySupervisorResponse = {
  id: "1",
  staff_id: "100",
  is_primary: true,
  first_name: "Maria",
  last_name: "Schmidt",
};

const sampleBackendActivity: ActivityResponse = {
  id: "1",
  name: "Football Club",
  max_participants: 20,
  is_open: true,
  category_id: "5",
  planned_room_id: "10",
  created_by: null,
  supervisor_id: "100",
  supervisors: [sampleBackendSupervisor],
  enrollment_count: 15,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-15T12:00:00Z",
  category: {
    id: "5",
    name: "Sport",
    description: "Sports activities",
    color: "#0000FF",
    is_system: false,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  },
  schedules: [
    {
      id: "1",
      weekday: 1,
      timeframe_id: "2",
      activity_group_id: "1",
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    },
  ],
};

// ===== SUPERVISOR TESTS =====

describe("formatSupervisorList", () => {
  it("formats list of supervisors with full names", () => {
    const supervisors: ActivitySupervisor[] = [
      {
        id: "1",
        staff_id: "100",
        is_primary: true,
        full_name: "Maria Schmidt",
      },
      {
        id: "2",
        staff_id: "101",
        is_primary: false,
        full_name: "Peter Mueller",
      },
    ];

    const result = formatSupervisorList(supervisors);

    expect(result).toBe("Maria Schmidt, Peter Mueller");
  });

  it("returns German message for empty or undefined list", () => {
    expect(formatSupervisorList(undefined)).toBe("Keine Betreuer zugewiesen");
    expect(formatSupervisorList([])).toBe("Keine Betreuer zugewiesen");
  });

  it("constructs name from first/last when full_name is missing", () => {
    const supervisors: ActivitySupervisor[] = [
      {
        id: "1",
        staff_id: "100",
        is_primary: true,
        first_name: "Anna",
        last_name: "Bauer",
      },
    ];

    const result = formatSupervisorList(supervisors);

    expect(result).toBe("Anna Bauer");
  });

  it("falls back to ID when no name info available", () => {
    const supervisors: ActivitySupervisor[] = [
      { id: "999", staff_id: "100", is_primary: true },
    ];

    const result = formatSupervisorList(supervisors);

    expect(result).toBe("Betreuer 999");
  });
});

// ===== ACTIVITY MAPPING TESTS =====

describe("mapActivityResponse", () => {
  it("maps backend activity to frontend structure", () => {
    const result = mapActivityResponse(sampleBackendActivity);

    expect(result.id).toBe("1");
    expect(result.name).toBe("Football Club");
    expect(result.max_participant).toBe(20);
    expect(result.is_open_ags).toBe(true);
    expect(result.ag_category_id).toBe("5");
    expect(result.planned_room_id).toBe("10");
    expect(result.participant_count).toBe(15);
    expect(result.category_name).toBe("Sport");
    expect(result.created_at).toBeInstanceOf(Date);
  });

  it("extracts supervisor info from detailed supervisors array", () => {
    const result = mapActivityResponse(sampleBackendActivity);

    expect(result.supervisor_id).toBe("100"); // primary supervisor's staff_id
    expect(result.supervisor_name).toBe("Maria Schmidt");
    expect(result.supervisors).toHaveLength(1);
  });

  it("falls back to supervisor_id field when no supervisors array", () => {
    const activityWithoutSupervisors: ActivityResponse = {
      ...sampleBackendActivity,
      supervisors: undefined,
      supervisor_id: "200",
    };

    const result = mapActivityResponse(activityWithoutSupervisors);

    expect(result.supervisor_id).toBe("200");
    expect(result.supervisors).toBeUndefined();
  });

  it("falls back to supervisor_ids array when no supervisors or supervisor_id", () => {
    const activityWithIds: ActivityResponse = {
      ...sampleBackendActivity,
      supervisors: undefined,
      supervisor_id: undefined,
      supervisor_ids: ["300", "301"],
    };

    const result = mapActivityResponse(activityWithIds);

    expect(result.supervisor_id).toBe("300"); // First in array
  });

  it("maps schedules to times array", () => {
    const result = mapActivityResponse(sampleBackendActivity);

    expect(result.times).toHaveLength(1);
    expect(result.times?.[0]?.weekday).toBe("1");
    expect(result.times?.[0]?.timeframe_id).toBe("2");
  });

  it("defaults participant_count to 0 when undefined", () => {
    const activityWithoutCount: ActivityResponse = {
      ...sampleBackendActivity,
      enrollment_count: undefined,
    };

    const result = mapActivityResponse(activityWithoutCount);

    expect(result.participant_count).toBe(0);
  });
});

describe("mapActivityCategoryResponse", () => {
  it("maps backend category to frontend structure", () => {
    const backendCategory: ActivityCategoryResponse = {
      id: "1",
      name: "Sport",
      description: "Sports activities",
      color: "#0000FF",
      is_system: false,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-15T12:00:00Z",
    };

    const result = mapActivityCategoryResponse(backendCategory);

    expect(result.id).toBe("1");
    expect(result.name).toBe("Sport");
    expect(result.description).toBe("Sports activities");
    expect(result.color).toBe("#0000FF");
    expect(result.created_at).toBeInstanceOf(Date);
    expect(result.updated_at).toBeInstanceOf(Date);
    expect(result.shiftTypeId).toBeUndefined();
  });

  it("maps the optional shift_type_id to a string (#1837 follow-up)", () => {
    const result = mapActivityCategoryResponse({
      id: "7",
      name: "Betreuung",
      is_system: false,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-15T12:00:00Z",
      shift_type_id: "42",
    });

    expect(result.shiftTypeId).toBe("42");
  });
});

// The schedules of an activity become its times (formerly pinned through the
// schedule route files, #7563).
describe("mapActivityResponse schedules", () => {
  it("maps a schedule to a time of the activity", () => {
    const result = mapActivityResponse({
      ...sampleBackendActivity,
      schedules: [
        {
          id: "1",
          weekday: 3,
          timeframe_id: "5",
          activity_group_id: "10",
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-15T12:00:00Z",
        },
      ],
    });

    const time = result.times?.[0];
    expect(time?.id).toBe("1");
    expect(time?.weekday).toBe("3");
    expect(time?.timeframe_id).toBe("5");
    expect(time?.activity_id).toBe("10"); // activity_group_id → activity_id
    expect(time?.created_at).toBeInstanceOf(Date);
  });

  it("handles missing timeframe_id", () => {
    const result = mapActivityResponse({
      ...sampleBackendActivity,
      schedules: [
        {
          id: "1",
          weekday: 1,
          activity_group_id: "10",
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
      ],
    });

    expect(result.times?.[0]?.weekday).toBe("1");
    expect(result.times?.[0]?.timeframe_id).toBeUndefined();
  });
});

describe("readActivity", () => {
  it("maps the contract's shape", () => {
    const result = readActivity(sampleBackendActivity);

    expect(result.id).toBe("1");
    expect(result.is_open_ags).toBe(true);
    expect(result.ag_category_id).toBe("5");
    expect(result.created_at).toBeInstanceOf(Date);
  });

  it("takes the shape of the previous release's route file as it is", () => {
    const mapped = mapActivityResponse(sampleBackendActivity);
    const sent = JSON.parse(JSON.stringify(mapped)) as unknown;

    expect(readActivity(sent)).toEqual(mapped);
  });
});

describe("readActivityCategory", () => {
  const category: ActivityCategoryResponse = {
    id: "3",
    name: "Kreativ",
    shift_type_id: "8",
    is_system: true,
    archived_at: "2024-02-01T00:00:00Z",
    usage_count: 4,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-15T12:00:00Z",
  };

  it("maps the contract's shape", () => {
    expect(readActivityCategory(category)).toEqual(
      mapActivityCategoryResponse(category),
    );
  });

  it("takes the shape of the previous release's route file as it is", () => {
    const mapped = mapActivityCategoryResponse(category);
    const sent = JSON.parse(JSON.stringify(mapped)) as unknown;

    expect(readActivityCategory(sent)).toEqual(mapped);
  });
});

// ===== STUDENT MAPPING TESTS =====

describe("mapStudentEnrollmentResponse", () => {
  it("maps enrollment with direct person fields", () => {
    const enrollment: BackendStudentEnrollment = {
      id: 100,
      first_name: "Anna",
      last_name: "Schmidt",
      school_class: "3b",
      current_location: "Anwesend",
      activity_group_id: 5,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-15T12:00:00Z",
    };

    const result = mapStudentEnrollmentResponse(enrollment);

    expect(result.id).toBe("100");
    expect(result.student_id).toBe("100"); // Backend returns id as student ID
    expect(result.name).toBe("Anna Schmidt");
    expect(result.school_class).toBe("3b");
    expect(result.activity_id).toBe("5");
    expect(result.current_location).toBe("Anwesend");
  });

  it("falls back to flattened fields when direct fields missing", () => {
    const enrollment: BackendStudentEnrollment = {
      id: 100,
      person__first_name: "Peter",
      person__last_name: "Mueller",
      student__school_class: "4a",
      student__current_location: "Schulhof",
    };

    const result = mapStudentEnrollmentResponse(enrollment);

    expect(result.name).toBe("Peter Mueller");
    expect(result.school_class).toBe("4a");
    expect(result.current_location).toBe("Schulhof");
  });

  it("returns 'Unnamed Student' when no name info available", () => {
    const enrollment: BackendStudentEnrollment = {
      id: 100,
    };

    const result = mapStudentEnrollmentResponse(enrollment);

    expect(result.name).toBe("Unnamed Student");
  });

  it("generates dates when not provided", () => {
    const enrollment: BackendStudentEnrollment = {
      id: 100,
    };

    const result = mapStudentEnrollmentResponse(enrollment);

    expect(result.created_at).toBeInstanceOf(Date);
    expect(result.updated_at).toBeInstanceOf(Date);
  });
});

describe("mapStudentEnrollmentsResponse", () => {
  it("maps array of enrollments", () => {
    const enrollments: BackendStudentEnrollment[] = [
      { id: 1, first_name: "Max", last_name: "Test" },
      { id: 2, first_name: "Anna", last_name: "Schmidt" },
    ];

    const result = mapStudentEnrollmentsResponse(enrollments);

    expect(result).toHaveLength(2);
    expect(result[0]?.name).toBe("Max Test");
    expect(result[1]?.name).toBe("Anna Schmidt");
  });
});

// ===== CREATOR CHECK =====

describe("isActivityCreator", () => {
  it("returns true when staff is the primary supervisor", () => {
    const activity: Activity = {
      id: "1",
      name: "Test",
      max_participant: 10,
      is_open_ags: true,
      supervisor_id: "100",
      ag_category_id: "1",
      created_at: new Date(),
      updated_at: new Date(),
      supervisors: [{ id: "1", staff_id: "100", is_primary: true }],
    };

    expect(isActivityCreator(activity, "100")).toBe(true);
  });

  it("returns false for non-primary supervisors", () => {
    const activity: Activity = {
      id: "1",
      name: "Test",
      max_participant: 10,
      is_open_ags: true,
      supervisor_id: "100",
      ag_category_id: "1",
      created_at: new Date(),
      updated_at: new Date(),
      supervisors: [
        { id: "1", staff_id: "100", is_primary: true },
        { id: "2", staff_id: "200", is_primary: false },
      ],
    };

    expect(isActivityCreator(activity, "200")).toBe(false);
  });

  it("uses first supervisor when no primary is marked", () => {
    const activity: Activity = {
      id: "1",
      name: "Test",
      max_participant: 10,
      is_open_ags: true,
      supervisor_id: "100",
      ag_category_id: "1",
      created_at: new Date(),
      updated_at: new Date(),
      supervisors: [{ id: "1", staff_id: "100", is_primary: false }],
    };

    expect(isActivityCreator(activity, "100")).toBe(true);
  });

  it("returns false for null/undefined staffId", () => {
    const activity: Activity = {
      id: "1",
      name: "Test",
      max_participant: 10,
      is_open_ags: true,
      supervisor_id: "100",
      ag_category_id: "1",
      created_at: new Date(),
      updated_at: new Date(),
      supervisors: [{ id: "1", staff_id: "100", is_primary: true }],
    };

    expect(isActivityCreator(activity, null)).toBe(false);
    expect(isActivityCreator(activity, undefined)).toBe(false);
  });

  it("returns false when no supervisors", () => {
    const activity: Activity = {
      id: "1",
      name: "Test",
      max_participant: 10,
      is_open_ags: true,
      supervisor_id: "100",
      ag_category_id: "1",
      created_at: new Date(),
      updated_at: new Date(),
    };

    expect(isActivityCreator(activity, "100")).toBe(false);
  });
});

// ===== AVAILABLE SUPERVISORS =====

describe("mapSupervisorOption", () => {
  it("names the staff member by first and last name", () => {
    expect(mapSupervisorOption(sampleBackendSupervisor)).toEqual({
      id: "1",
      name: "Maria Schmidt",
    });
  });

  it("falls back to the id when the names are missing", () => {
    expect(
      mapSupervisorOption({ id: "999", staff_id: "999", is_primary: false }),
    ).toEqual({ id: "999", name: "Supervisor 999" });
  });
});

describe("isSystemActivity", () => {
  const makeActivity = (name: string): Activity => ({
    id: "1",
    name,
    max_participant: 20,
    is_open_ags: false,
    supervisor_id: "1",
    ag_category_id: "1",
    created_at: new Date(),
    updated_at: new Date(),
  });

  it("returns true for Schulhof Freispiel", () => {
    expect(isSystemActivity(makeActivity("Schulhof Freispiel"))).toBe(true);
  });

  it("returns true for WC", () => {
    expect(isSystemActivity(makeActivity("WC"))).toBe(true);
  });

  it("returns false for regular activity", () => {
    expect(isSystemActivity(makeActivity("Basteln"))).toBe(false);
  });

  it("returns false for null", () => {
    expect(isSystemActivity(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isSystemActivity(undefined)).toBe(false);
  });
});
