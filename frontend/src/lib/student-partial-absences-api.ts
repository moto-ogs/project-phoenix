import { bffJson } from "~/lib/bff-fetch";
import type {
  PartialAbsenceRequest,
  PartialAbsenceResponse,
} from "~/lib/contract/students.generated";

export interface StudentPartialAbsence {
  id: string;
  studentId: string;
  date: string;
  fromTime: string;
  reason?: string;
  pickupTime?: string;
  /** true = automatisch aus vorverlegter Abholzeit abgeleitet (#2360). */
  auto: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

function mapPartialAbsence(row: PartialAbsenceResponse): StudentPartialAbsence {
  return {
    id: row.id,
    studentId: row.student_id,
    date: row.date,
    fromTime: row.from_time,
    reason: row.reason,
    pickupTime: row.pickup_time,
    auto: row.auto,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function fetchStudentPartialAbsences(
  studentId: string,
  from: string,
  to: string,
): Promise<StudentPartialAbsence[]> {
  const rows = await bffJson(
    "tenant",
    "GET /api/students/{id}/partial-absences",
    { params: { id: studentId }, query: { from, to } },
  );
  return rows.map(mapPartialAbsence);
}

export async function saveStudentPartialAbsence(
  studentId: string,
  partialAbsenceId: string | null,
  date: string,
  fromTime: string,
  reason?: string,
): Promise<StudentPartialAbsence> {
  const body: PartialAbsenceRequest = reason
    ? { date, from_time: fromTime, reason }
    : { date, from_time: fromTime };
  const row = partialAbsenceId
    ? await bffJson(
        "tenant",
        "PUT /api/students/{id}/partial-absences/{partialAbsenceId}",
        { params: { id: studentId, partialAbsenceId }, body },
      )
    : await bffJson("tenant", "POST /api/students/{id}/partial-absences", {
        params: { id: studentId },
        body,
      });
  return mapPartialAbsence(row);
}

export async function deleteStudentPartialAbsence(
  studentId: string,
  partialAbsenceId: string,
): Promise<void> {
  await bffJson(
    "tenant",
    "DELETE /api/students/{id}/partial-absences/{partialAbsenceId}",
    { params: { id: studentId, partialAbsenceId } },
  );
}
