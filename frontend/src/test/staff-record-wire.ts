// Temporary (#7563): a staff record as the backend writes it, for the tests
// of the staff route files that stay for one production deploy. Delete it
// with them.

/** One staff record on the backend's wire: person ids still numbers. */
export function backendStaffRecord(overrides: Record<string, unknown> = {}) {
  return {
    started_on: "2024-09-02",
    ended_on: null,
    id: "7",
    person_id: "10",
    staff_notes: "Notiz",
    person: {
      id: 10,
      first_name: "John",
      last_name: "Doe",
      email: "john@example.com",
      avatar: "/uploads/avatars/global/john.png",
      tag_id: "TAG1",
      account_id: 50,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    },
    is_teacher: true,
    teacher_id: 5,
    specialization: "Math",
    was_present_today: true,
    is_external: false,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

/** The fields bundles built before #7563 read, for that record. */
export const legacyStaffFields = {
  name: "John Doe",
  firstName: "John",
  lastName: "Doe",
  first_name: "John",
  last_name: "Doe",
  email: "john@example.com",
  avatar: "/uploads/avatars/global/john.png",
  account_id: "50",
  tag_id: "TAG1",
  staff_id: "7",
};
