// The Teacher shape of the database pages, apart from `teacher-api` so that
// the mapper in `teacher-helpers` and the client can both name it.
import type { RoleForm } from "~/lib/position-title";
import type { Activity } from "./activity-helpers";
import type { ExternalAccountStatus } from "./staff-api";

export interface Teacher {
  id: string;
  name: string;
  first_name: string;
  last_name: string;
  email?: string; // Email address for authentication
  avatar?: string | null; // Avatar path from account
  specialization?: string | null;
  role?: string | null;
  /** Form der Position aus den Stammdaten (`feminine`/`masculine`), fehlt ohne Angabe. */
  role_form?: RoleForm | null;
  account_role?: string | null;
  qualifications?: string | null;
  tag_id?: string | null;
  staff_notes?: string | null;
  created_at?: string;
  updated_at?: string;
  activities?: Activity[];
  // Optional fields from staff API for consistency
  /**
   * The person behind this staff record, as a decimal string (#2222).
   *
   * It is a PostgreSQL bigint and the edit flow sends it straight back — to
   * `/api/users/{person_id}` for the name and tag, and in the staff update body
   * — so it must never live as a JS number: a value beyond
   * `Number.MAX_SAFE_INTEGER` is rounded into a valid id for a DIFFERENT
   * person, which turns a failed edit into an edit of the wrong record. The
   * backend serializes it as a string for exactly this reason and takes either
   * form back.
   */
  person_id?: string;
  /** Konto-ID als Dezimalzeichenfolge; PostgreSQL `int64` bleibt exakt. */
  account_id?: string;
  is_teacher?: boolean;
  /** Externe Betreuungskraft, mit oder ohne moto-Konto (#3823, #4573). */
  is_external?: boolean;
  external_organization?: string | null;
  /** Kontostand der externen Kraft (#4573); fehlt bei allen anderen. */
  external_account_status?: ExternalAccountStatus | null;
  person?: unknown; // For nested person object
  // ID fields for proper mapping
  staff_id?: string;
  teacher_id?: string;
}
