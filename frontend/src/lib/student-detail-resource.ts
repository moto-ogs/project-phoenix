import type * as studentsContract from "~/lib/contract/students.generated";
import { fetchStudent } from "~/lib/student-api";
import type { Student } from "~/lib/student-helpers";

/**
 * Blanks what a caller without read access must not see. The absence
 * statuses also follow the absence-write gate: they are the state the Krank-/
 * Entschuldigt-Aktionen toggle, so blanking them for a caller who may write
 * them would always render "melden" and turn a clearing click into a fresh
 * report (#2232).
 */
function gateForAccess(
  student: Student,
  hasAccess: boolean,
  canManageAbsence: boolean,
): Student {
  const readable = <T>(value: T | undefined) =>
    hasAccess ? (value ?? undefined) : undefined;
  const canSeeAbsence = hasAccess || canManageAbsence;
  return {
    ...student,
    first_name: student.first_name ?? "",
    second_name: student.second_name ?? "",
    group_id: student.group_id ?? "",
    group_name: student.group_name ?? "",
    location_since: readable(student.location_since),
    extra_info: readable(student.extra_info),
    address_street: readable(student.address_street),
    address_city: readable(student.address_city),
    address_postal_code: readable(student.address_postal_code),
    actual_arrival_time: readable(student.actual_arrival_time),
    actual_pickup_time: readable(student.actual_pickup_time),
    sick: canSeeAbsence ? (student.sick ?? false) : false,
    sick_since: canSeeAbsence ? student.sick_since : undefined,
    excused: canSeeAbsence ? (student.excused ?? false) : false,
    excused_since: canSeeAbsence ? student.excused_since : undefined,
    class_trip: canSeeAbsence ? (student.class_trip ?? false) : false,
    class_trip_since: canSeeAbsence ? student.class_trip_since : undefined,
    has_full_access: hasAccess,
  };
}

export interface StudentDetailResponse {
  student: Student;
  hasFullAccess: boolean;
  hasWriteAccess: boolean;
  hasAbsenceWriteAccess: boolean;
  hasSickExcusedWriteAccess: boolean;
  attendanceLogEnabled: boolean;
  feedbackEnabled: boolean;
  supervisors: studentsContract.SupervisorContact[];
}

/** Complete detail projection for the browser's child record read. */
export async function fetchStudentDetail(
  studentId: string,
): Promise<StudentDetailResponse> {
  const student = await fetchStudent(studentId);

  const hasAccess = student.has_full_access ?? false;
  const hasAbsenceWriteAccess = student.has_absence_write_access ?? false;
  const extendedStudent = gateForAccess(
    student,
    hasAccess,
    hasAbsenceWriteAccess,
  );

  return {
    student: extendedStudent,
    hasFullAccess: hasAccess,
    hasWriteAccess: student.has_write_access ?? false,
    hasAbsenceWriteAccess,
    hasSickExcusedWriteAccess: student.has_sick_excused_write_access ?? false,
    attendanceLogEnabled: student.attendance_log_enabled ?? false,
    feedbackEnabled: student.feedback_enabled ?? false,
    supervisors: student.group_supervisors ?? [],
  };
}
