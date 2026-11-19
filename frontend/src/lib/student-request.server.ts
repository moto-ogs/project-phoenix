// Temporary (#7563): what the student BFF routes accept from an older app
// bundle before anything reaches the backend. The current client builds the
// body itself (student-request.ts). Delete with the two route files after
// the next production deploy.

import { bffError } from "~/lib/api-response-error.server";
import type { StudentRequest } from "./contract/students.generated";
import type { StudentUpdate } from "./student-helpers";
import type { ConsentPairInput } from "./student-privacy-consent.server";
import {
  studentCreateRequest,
  type StudentCreateBody,
} from "./student-request";

export type { StudentCreateBody };

export type StudentUpdateBody = StudentUpdate & ConsentPairInput;

const RETIRED_CONTACT_KEYS = new Set([
  "name_lg",
  "contact_lg",
  "guardian_name",
  "guardian_contact",
  "guardian_email",
  "guardian_phone",
]);

/** Guardian contacts moved to the guardian profiles; refuse the old keys. */
export function rejectRetiredStudentContacts(body: object): void {
  for (const key of Object.keys(body)) {
    if (RETIRED_CONTACT_KEYS.has(key.toLowerCase())) {
      throw bffError(
        400,
        `${key} is no longer supported on students; use guardian contacts`,
      );
    }
  }
}

/** The backend body of a create; refuses a body without the required names. */
export function buildStudentCreateRequest(
  body: StudentCreateBody,
): StudentRequest {
  rejectRetiredStudentContacts(body);
  const required = [
    {
      field: "first_name",
      label: "First name",
      value: body.first_name?.trim() ?? "",
    },
    {
      field: "last_name",
      label: "Last name",
      value: body.second_name?.trim() ?? "",
    },
    {
      field: "school_class",
      label: "School class",
      value: body.school_class?.trim() ?? "",
    },
  ];
  const missing = required.filter(({ value }) => !value);
  if (missing.length > 0) {
    throw bffError(
      400,
      missing.map(({ label }) => `${label} is required`).join(". "),
      { errors: missing.map(({ field }) => ({ field, reason: "required" })) },
    );
  }

  return studentCreateRequest(body);
}
