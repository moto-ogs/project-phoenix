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
  /** What an update of this entry sends back (ADR 0311). */
  version: string;
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
    version: row.version,
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

/**
 * Creates a partial absence, or updates `editing` against the version the
 * form read: the backend refuses an update with `general.changed_since_read`
 * when the entry changed since (ADR 0311).
 */
export async function saveStudentPartialAbsence(
  studentId: string,
  editing: { readonly id: string; readonly version: string } | null,
  date: string,
  fromTime: string,
  reason?: string,
): Promise<StudentPartialAbsence> {
  const body: PartialAbsenceRequest = reason
    ? { date, from_time: fromTime, reason }
    : { date, from_time: fromTime };
  const row = editing
    ? await bffJson(
        "tenant",
        "PUT /api/students/{id}/partial-absences/{partialAbsenceId}",
        {
          params: { id: studentId, partialAbsenceId: editing.id },
          body: { ...body, expected_version: editing.version },
        },
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
