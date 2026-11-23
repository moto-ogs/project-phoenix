// The Teacher shape of the database pages, apart from `teacher-api` so that
// the mapper in `teacher-helpers` and the client can both name it.
import type * as staffContract from "~/lib/contract/staff.generated";
import type { RoleForm } from "~/lib/position-title";
import type { Activity } from "./activity-helpers";
import type { ExternalAccountStatus } from "./staff-api";

/**
 * A staff record as the database pages and the Konto tab hold it: the
 * record of the contract with its person's fields flattened in
 * (`mapTeacherResponse`). A free-text field the backend omits is null here,
 * as the forms read and send it back.
 */
export type Teacher = Pick<staffContract.StaffRecordResponse, "id"> &
  Pick<staffContract.StaffPersonResponse, "first_name" | "last_name"> &
  Partial<Pick<staffContract.StaffPersonResponse, "email" | "account_id">> &
  Partial<
    Pick<
      staffContract.StaffRecordResponse,
      | "created_at"
      | "updated_at"
      | "person_id"
      | "is_teacher"
      | "is_external"
      | "teacher_id"
    >
  > & {
    /** First and last name, joined. */
    name: string;
    // Free text the form clears with null.
    avatar?: string | null;
    specialization?: string | null;
    role?: string | null;
    /** Form der Position aus den Stammdaten (`feminine`/`masculine`), fehlt ohne Angabe. */
    role_form?: RoleForm | null;
    account_role?: string | null;
    qualifications?: string | null;
    tag_id?: string | null;
    staff_notes?: string | null;
    external_organization?: string | null;
    /** Kontostand der externen Kraft (#4573), auf die bekannten Werte eingegrenzt. */
    external_account_status?: ExternalAccountStatus | null;
    activities?: Activity[];
    person?: unknown; // For nested person object
    /** The record id again, under the name the staff forms send. */
    staff_id?: string;
    /**
     * Version of the record form (ADR 0311), for staff:manage only: the
     * staff PUT sends it back as expected_version.
     */
    version?: string;
    /** Version of the person: the name change sends it back. */
    person_version?: string;
  };
