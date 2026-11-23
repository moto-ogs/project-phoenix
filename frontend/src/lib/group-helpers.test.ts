import { describe, it, expect } from "vitest";
import { mapGroupResponse, mapGroupsResponse } from "./group-helpers";
import { suppressConsole } from "~/test/helpers/console";
import { buildBackendGroup } from "~/test/fixtures/groups";
import type * as groupsContract from "~/lib/contract/groups.generated";

// Sample backend group for testing
const sampleBackendGroup = buildBackendGroup({
  id: "1",
  name: "Klasse 3a",
  room_id: "10",
  room: {
    id: "10",
    name: "Raum 101",
  },
  representative_id: "5",
  representative: {
    id: "5",
    staff_id: "50",
    first_name: "Maria",
    last_name: "Schmidt",
    full_name: "Maria Schmidt",
    specialization: "Mathematics",
    role: "teacher",
  },
  teachers: [
    {
      id: "5",
      staff_id: "50",
      first_name: "Maria",
      last_name: "Schmidt",
      full_name: "Maria Schmidt",
      specialization: "Mathematics",
      role: "teacher",
    },
    {
      id: "6",
      staff_id: "51",
      first_name: "Peter",
      last_name: "Mueller",
      full_name: "Peter Mueller",
      specialization: "German",
      role: "teacher",
    },
  ],
  student_count: 25,
});

describe("mapGroupResponse", () => {
  it("maps backend group to frontend structure", () => {
    const result = mapGroupResponse(sampleBackendGroup);

    expect(result.id).toBe("1");
    expect(result.name).toBe("Klasse 3a");
    expect(result.room_id).toBe("10");
    expect(result.room_name).toBe("Raum 101");
    expect(result.representative_id).toBe("5");
    expect(result.representative_name).toBe("Maria Schmidt");
    expect(result.student_count).toBe(25);
    expect(result.created_at).toBe("2024-01-01T00:00:00Z");
    expect(result.updated_at).toBe("2024-01-15T12:00:00Z");
  });

  it("maps representative details when available", () => {
    const result = mapGroupResponse(sampleBackendGroup);

    expect(result.representative).toBeDefined();
    expect(result.representative?.id).toBe("5");
    expect(result.representative?.staffId).toBe("50");
    expect(result.representative?.firstName).toBe("Maria");
    expect(result.representative?.lastName).toBe("Schmidt");
    expect(result.representative?.fullName).toBe("Maria Schmidt");
  });

  it("maps teachers to supervisors and extracts teacher_ids", () => {
    const result = mapGroupResponse(sampleBackendGroup);

    expect(result.supervisors).toHaveLength(2);
    expect(result.supervisors?.[0]?.id).toBe("5");
    expect(result.supervisors?.[0]?.name).toBe("Maria Schmidt");
    expect(result.supervisors?.[1]?.id).toBe("6");
    expect(result.supervisors?.[1]?.name).toBe("Peter Mueller");

    expect(result.teacher_ids).toEqual(["5", "6"]);
  });

  it("handles group without room", () => {
    const groupWithoutRoom: groupsContract.GroupResponse = {
      ...sampleBackendGroup,
      room_id: undefined,
      room: undefined,
    };

    const result = mapGroupResponse(groupWithoutRoom);

    expect(result.room_id).toBeUndefined();
    expect(result.room_name).toBeUndefined();
  });

  it("handles group without representative", () => {
    const groupWithoutRep: groupsContract.GroupResponse = {
      ...sampleBackendGroup,
      representative_id: undefined,
      representative: undefined,
    };

    const result = mapGroupResponse(groupWithoutRep);

    expect(result.representative_id).toBeUndefined();
    expect(result.representative_name).toBeUndefined();
    expect(result.representative).toBeUndefined();
  });

  it("handles group without teachers array", () => {
    const groupWithoutTeachers: groupsContract.GroupResponse = {
      ...sampleBackendGroup,
      teachers: undefined,
    };

    const result = mapGroupResponse(groupWithoutTeachers);

    expect(result.supervisors).toBeUndefined();
    expect(result.teacher_ids).toBeUndefined();
  });
});

describe("mapGroupsResponse", () => {
  const consoleSpies = suppressConsole("error");

  it("maps array of backend groups", () => {
    const groups = [sampleBackendGroup, { ...sampleBackendGroup, id: "2" }];

    const result = mapGroupsResponse(groups);

    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe("1");
    expect(result[1]?.id).toBe("2");
  });

  it("handles empty array", () => {
    const result = mapGroupsResponse([]);

    expect(result).toEqual([]);
  });

  it("returns empty array for non-array input", () => {
    const result = mapGroupsResponse(
      "invalid" as unknown as groupsContract.GroupResponse[],
    );

    expect(result).toEqual([]);
    expect(consoleSpies.error).toHaveBeenCalledWith(
      "expected array for backendGroups",
      { received: "string" },
    );
  });
});
