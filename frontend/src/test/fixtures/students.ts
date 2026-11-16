import {
  StudentResponseSchema,
  type StudentResponse,
} from "~/lib/contract/students.generated";
import type { Student } from "~/lib/student-helpers";

let studentIdCounter = 0;

function nextId() {
  return ++studentIdCounter;
}

type IdField = "id" | "person_id" | "group_id" | "photo_consent_given_by";

/** A backend row as Go writes it: identifiers may still be numbers. */
export type BackendStudentInput = Partial<Omit<StudentResponse, IdField>> &
  Partial<Record<IdField, string | number>>;

/**
 * Builds the full student row of the backend (snake_case) and reads it
 * through the generated decoder, as the BFF routes do. All fields can be
 * overridden; an override the contract does not allow fails here.
 */
export function buildBackendStudent(
  overrides?: BackendStudentInput,
): StudentResponse {
  const id = overrides?.id ?? nextId();
  return StudentResponseSchema.parse({
    id,
    person_id: 100 + Number(id),
    first_name: "Max",
    last_name: "Mustermann",
    school_class: "3a",
    current_location: "Schule",
    group_id: 10,
    tag_id: `TAG${String(id).padStart(3, "0")}`,
    bus: false,
    sick: false,
    excused: false,
    class_trip: false,
    has_full_access: false,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-15T12:00:00Z",
    ...overrides,
  });
}

/**
 * Builds a frontend Student with sensible defaults (string IDs, camelCase).
 */
export function buildStudent(overrides?: Partial<Student>): Student {
  const id = overrides?.id ?? String(nextId());
  return {
    id,
    name: "Max Mustermann",
    first_name: "Max",
    second_name: "Mustermann",
    school_class: "3a",
    current_location: "Schule",
    group_id: "10",
    ...overrides,
  };
}
