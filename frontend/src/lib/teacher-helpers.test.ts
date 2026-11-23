import { describe, expect, it } from "vitest";
import type { StaffRecordResponse } from "./contract/staff.generated";
import { mapTeacherResponse } from "./teacher-helpers";

// The staff record as the contract delivers it (#7563). These cases were the
// tests of the former /api/staff and /api/staff/[id] route files, which
// flattened the record before the client mapped it a second time.
const record: StaffRecordResponse = {
  started_on: "2024-09-02",
  ended_on: null,
  id: "9007199254740993",
  person_id: "9007199254740995",
  staff_notes: "Notiz",
  person: {
    id: "9007199254740995",
    first_name: "John",
    last_name: "Doe",
    email: "john@example.com",
    avatar: "/uploads/avatars/global/john.png",
    tag_id: "TAG1",
    account_id: "9007199254740997",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    version: "person-version",
  },
  is_teacher: true,
  teacher_id: "5",
  specialization: "Math",
  role: "Leitung",
  account_role: "admin",
  was_present_today: true,
  is_external: false,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-02T00:00:00Z",
  version: "record-v1",
};

describe("mapTeacherResponse", () => {
  it("flattens the person and keeps every bigint id digit for digit", () => {
    expect(mapTeacherResponse(record)).toEqual({
      id: "9007199254740993",
      name: "John Doe",
      first_name: "John",
      last_name: "Doe",
      email: "john@example.com",
      avatar: "/uploads/avatars/global/john.png",
      specialization: "Math",
      role: "Leitung",
      account_role: "admin",
      qualifications: null,
      tag_id: "TAG1",
      staff_notes: "Notiz",
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-02T00:00:00Z",
      person_id: "9007199254740995",
      account_id: "9007199254740997",
      is_teacher: true,
      staff_id: "9007199254740993",
      teacher_id: "5",
      person: record.person,
      // Die Stände von Datensatz und Person gehen mit (ADR 0311).
      version: "record-v1",
      person_version: "person-version",
    });
  });

  it("reads a record without person or teacher profile as empty", () => {
    const teacher = mapTeacherResponse({
      ...record,
      person: undefined,
      is_teacher: false,
      teacher_id: undefined,
      specialization: undefined,
    });
    expect(teacher.name).toBe("");
    expect(teacher.first_name).toBe("");
    expect(teacher.account_id).toBeUndefined();
    expect(teacher.teacher_id).toBeUndefined();
    expect(teacher.specialization).toBe("");
    expect(teacher).not.toHaveProperty("is_external");
  });

  it("carries the external caregiver fields only for an external record", () => {
    const teacher = mapTeacherResponse({
      ...record,
      is_external: true,
      external_organization: "Musikschule",
      external_account_status: "invitation_pending",
    });
    expect(teacher).toMatchObject({
      is_external: true,
      external_organization: "Musikschule",
      external_account_status: "invitation_pending",
    });
    expect(
      mapTeacherResponse({
        ...record,
        is_external: true,
        external_account_status: "a-state-of-a-later-release",
      }).external_account_status,
    ).toBeNull();
  });
});
