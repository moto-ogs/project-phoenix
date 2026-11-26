// What the browser sends to create a student: the child, its guardians and
// weekly schedules in one backend transaction (POST /api/students).

import type { StudentGuardianPayload } from "~/lib/guardian-helpers";
import type { ArrivalScheduleFormEntry } from "~/lib/arrival-schedule-helpers";
import type { StudentRequest } from "./contract/students.generated";
import type { StudentUpdate } from "./student-helpers";
import type { ConsentPairInput } from "./student-privacy-consent";
import { prepareStudentForBackend } from "./student-wire";

/** A create also creates guardians and weekly schedules atomically. */
export type StudentCreateBody = StudentUpdate &
  ConsentPairInput &
  Pick<StudentRequest, "pickup_schedules"> & {
    guardians?: StudentGuardianPayload[];
    arrival_schedules?: ArrivalScheduleFormEntry[];
  };

/**
 * The backend body of a create. Names and class go out trimmed; the backend
 * refuses a blank one as a field error.
 */
export function studentCreateRequest(body: StudentCreateBody): StudentRequest {
  return {
    ...prepareStudentForBackend(body),
    first_name: body.first_name?.trim() ?? "",
    last_name: body.second_name?.trim() ?? "",
    school_class: body.school_class?.trim() ?? "",
    ...(body.guardians?.length && { guardians: body.guardians }),
    ...(body.arrival_schedules?.length && {
      arrival_schedules: body.arrival_schedules,
    }),
    ...(body.pickup_schedules?.length && {
      pickup_schedules: body.pickup_schedules,
    }),
    // A child of the class without an OGS place (#4803); the backend refuses
    // it unless the school keeps such children.
    ...(body.without_care_place === true && { without_care_place: true }),
  };
}
