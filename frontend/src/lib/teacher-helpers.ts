import type { Teacher } from "./teacher-types";
import type { StaffRecordResponse } from "./contract/staff.generated";
import { EXTERNAL_ACCOUNT_STATUS_VALUES } from "./staff-wire-enums";
import { knownEnum } from "./contract/known-enum";

/**
 * Maps a staff record of the contract (GET /api/staff, /api/staff/{id}) to
 * the Teacher shape of the database pages and the Konto tab. The record is
 * mapped once, here, from the form the backend sends (#7563): the person
 * nested, ids as decimal strings. An absent free-text field stays null, as
 * the screens have always read it.
 */
export function mapTeacherResponse(data: StaffRecordResponse): Teacher {
  const person = data.person;
  const firstName = person?.first_name ?? "";
  const lastName = person?.last_name ?? "";

  return {
    id: data.id,
    name: person ? `${firstName} ${lastName}` : "",
    first_name: firstName,
    last_name: lastName,
    email: person?.email,
    avatar: person?.avatar ?? null,
    specialization: data.specialization ?? "",
    role: data.role ?? null,
    account_role: data.account_role ?? null,
    qualifications: data.qualifications ?? null,
    tag_id: person?.tag_id ?? null,
    staff_notes: data.staff_notes ?? null,
    created_at: data.created_at,
    updated_at: data.updated_at,
    // Decimal string — the id is a bigint and travels back untouched (#2222).
    person_id: data.person_id,
    account_id: person?.account_id,
    is_teacher: data.is_teacher,
    // Nur für externe Kräfte (#3823), damit bestehende Formen gleich bleiben.
    ...(data.is_external
      ? {
          is_external: true,
          external_organization: data.external_organization ?? null,
          // Kontostand für „Kein Konto“ / „Einladung offen“ (#4573).
          external_account_status:
            knownEnum(
              EXTERNAL_ACCOUNT_STATUS_VALUES,
              data.external_account_status,
            ) ?? null,
        }
      : {}),
    staff_id: data.id,
    teacher_id: data.teacher_id,
    person,
    version: data.version,
    person_version: person?.version,
  };
}
