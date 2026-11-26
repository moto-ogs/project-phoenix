// This file contains the Teacher API service and related types

import type * as linkToTenantContract from "~/lib/contract/auth-link-to-tenant.generated";
import { bffJson } from "./bff-fetch";
import { ApiError, wireErrorCode } from "~/lib/api-error";
import type { SchoolIdentityResponse } from "./contract/shared.generated";
import type { DirectoryPersonRequest } from "./contract/users.generated";
import type { StaffRequest } from "./contract/staff.generated";
import { createLogger } from "~/lib/logger";
import { mapTeacherResponse } from "./teacher-helpers";
import type { Teacher } from "./teacher-types";

const logger = createLogger({ component: "TeacherAPI" });

/** Result of a createTeacher call — either success or a prompt to link an existing account. */
type CreateTeacherResult =
  | { status: "created"; data: TeacherWithCredentials }
  | { status: "account_exists"; email: string };

/** The person fields the backend needs to provision a staff identity. */
type PersonIdentityFields = Required<
  Pick<linkToTenantContract.LinkToTenantRequest, "first_name" | "last_name">
> &
  Pick<linkToTenantContract.LinkToTenantRequest, "tag_id">;

/**
 * Builds the POST /api/staff body, carrying person_id as a decimal string.
 *
 * person_id is a PostgreSQL bigint and reaches us as the string the backend
 * sent. Sending it as a JSON number would round it once it exceeds
 * Number.MAX_SAFE_INTEGER, and the rounded value is a valid id for a different
 * person — a wrong staff record rather than a failed request. A string has no
 * such limit, and it survives the one hop that used to undo the precaution: our
 * own /api/staff route parses the body and re-serializes it before forwarding,
 * so exact digits spliced in here were rounded there anyway. That route now
 * takes the string and puts the digits back on the wire to the backend.
 *
 * Validated here as well, so a malformed id fails with a German message from
 * the screen that submitted it rather than as a route error.
 */
function buildStaffRequestBody<F extends object>(
  personId: string,
  fields: F,
): F & { person_id: string } {
  if (!/^\d+$/.test(personId)) {
    throw new Error(
      "Der Personal-Datensatz konnte nicht angelegt werden: ungültige Personen-ID.",
    );
  }
  return { person_id: personId, ...fields };
}

// Define Teacher interface aligned with staff API response structure
export type { Teacher } from "./teacher-types";

/**
 * The person as a person write stored it: the record read with the written
 * fields and the version the write answered (undefined without an answer).
 */
export type SavedPerson = Readonly<
  Pick<Teacher, "first_name" | "last_name" | "tag_id" | "person_version">
>;

export interface TeacherWithCredentials extends Teacher {
  temporaryCredentials?: {
    email: string;
    password: string;
  };
}

// Teacher service with API methods
class TeacherService {
  // Create a new teacher
  async createTeacher(
    teacherData: Omit<Teacher, "id" | "name" | "created_at" | "updated_at"> & {
      password?: string;
      role_id?: string;
      linkExisting?: boolean;
    },
  ): Promise<CreateTeacherResult> {
    const roleId = teacherData.role_id;
    if (!roleId) {
      throw new Error("Role ID is required for creating a teacher");
    }

    const email =
      teacherData.email ??
      `${teacherData.first_name.toLowerCase()}.${teacherData.last_name.toLowerCase()}@school.local`;
    const suffix = Math.random().toString(36).slice(2, 8);
    const username = `${teacherData.first_name.toLowerCase()}_${teacherData.last_name.toLowerCase()}_${suffix}`;
    const fullName = `${teacherData.first_name} ${teacherData.last_name}`;

    // Step 1: Create account or link existing. The identity fields go with it,
    // so the backend creates the person and staff record in the same
    // transaction (#2222) instead of us stitching the chain together across
    // three requests that can fail in the middle.
    let identity: SchoolIdentityResponse;
    if (teacherData.linkExisting) {
      // Link existing account — password is NOT changed
      identity = await this.linkAccountToTenant(email, roleId, teacherData);
    } else {
      const password = teacherData.password;
      if (!password) {
        throw new Error("Password is required for creating a teacher");
      }
      // Try to create — if email exists, return account_exists result (not an error)
      const createResult = await this.tryCreateAccount(
        email,
        username,
        fullName,
        password,
        roleId,
        teacherData,
      );
      if (createResult.status === "account_exists") {
        return { status: "account_exists", email };
      }
      identity = createResult.identity;
    }

    // Step 2: apply the staff details to the record that already exists. The
    // backend adopts it instead of creating a second one.
    const staffData = await this.createStaff(teacherData, identity);

    // Return with credentials and name data
    return {
      status: "created",
      data: {
        ...staffData,
        first_name: teacherData.first_name,
        last_name: teacherData.last_name,
        name: fullName,
        email: email,
        temporaryCredentials: teacherData.linkExisting
          ? undefined
          : { email, password: teacherData.password ?? "" },
      } as TeacherWithCredentials,
    };
  }

  /** Tries to create an account — returns account_exists status instead of throwing. */
  private async tryCreateAccount(
    email: string,
    username: string,
    name: string,
    password: string,
    roleId: string,
    identity: PersonIdentityFields,
  ): Promise<
    | { status: "created"; identity: SchoolIdentityResponse }
    | { status: "account_exists" }
  > {
    let account;
    try {
      account = await bffJson("tenant", "POST /auth/register", {
        body: {
          email,
          username,
          password,
          confirm_password: password,
          role_id: roleId,
          first_name: identity.first_name,
          last_name: identity.last_name,
          tag_id: identity.tag_id ?? null,
        },
        errorMessage: "account registration failed",
      });
    } catch (error) {
      // Ein vorhandenes Konto wird zum Verknüpfen angeboten; erkannt am
      // Code, nie am Text (#2517).
      if (
        error instanceof ApiError &&
        wireErrorCode(error.code) === "identity.email_already_exists"
      ) {
        return { status: "account_exists" as const };
      }
      throw error;
    }

    if (!account.school_identity) {
      logger.error("account created without school identity");
      // Eine 2xx-Antwort ohne Personaldatensatz ist ein Serverfehler. Ein
      // erneutes Anlegen erkennt das Konto und bietet das Verknüpfen an.
      throw new ApiError("account created without school identity", 500);
    }

    return { status: "created" as const, identity: account.school_identity };
  }

  /** Links an existing account to the current tenant. */
  private async linkAccountToTenant(
    email: string,
    roleId: string,
    identity: PersonIdentityFields,
  ): Promise<SchoolIdentityResponse> {
    const account = await bffJson("tenant", "POST /auth/link-to-tenant", {
      body: {
        email,
        role_id: roleId,
        first_name: identity.first_name,
        last_name: identity.last_name,
        tag_id: identity.tag_id ?? null,
      },
      errorMessage: "account link failed",
    });
    if (!account.school_identity) {
      throw new ApiError("account link response without school identity", 500);
    }
    return account.school_identity;
  }

  /**
   * Schreibt die Personaldetails auf den Datensatz, den die Provisionierung
   * bereits angelegt hat.
   *
   * `is_teacher` kommt aus genau dieser Provisionierung und nicht mehr aus dem
   * Formular: das Backend entscheidet die Frage an der Rollenstufe
   * (RoleNeedsCaregiverProfile) und legt users.teachers nur für die
   * Betreuer-Stufe an. Das Formular kannte davon nur die Lehrkraft-Ausnahme und
   * schickte sonst is_teacher=true — eine Verwaltungsrolle bekam dadurch hier
   * doch noch ein Betreuungsprofil, das EnsureSchoolIdentityResponse eine Anfrage
   * vorher bewusst weggelassen hatte. Die angelegte Identität ist die Antwort;
   * eine zweite Ableitung derselben Regel im Frontend würde nur wieder
   * auseinanderlaufen.
   */
  private async createStaff(
    teacherData: {
      staff_notes?: string | null;
      specialization?: string | null;
      role?: string | null;
      qualifications?: string | null;
    },
    identity: SchoolIdentityResponse,
  ): Promise<Teacher> {
    const staff = await bffJson("tenant", "POST /api/staff/", {
      body: buildStaffRequestBody(identity.person_id, {
        is_teacher: Boolean(identity.teacher_id),
        staff_notes: teacherData.staff_notes?.trim() ?? "",
        specialization: teacherData.specialization?.trim() ?? "",
        role: teacherData.role?.trim() ?? "",
        qualifications: teacherData.qualifications?.trim() ?? "",
      }),
      errorMessage: "staff create failed",
    });
    return mapTeacherResponse(staff);
  }

  // Update an existing teacher
  async updateTeacher(
    id: string,
    teacherData: Partial<Teacher>,
    currentTeacher: Teacher,
    options: {
      /**
       * The person write went through; the staff write follows and may
       * still fail. Its answer is the person's new state (ADR 0311): a
       * retry rests on it instead of resending the old version.
       */
      readonly onPersonSaved?: (person: SavedPerson) => void;
    } = {},
  ): Promise<Teacher> {
    // The caller already loaded this record. Keep its IDs, profile state and
    // unchanged fields: the staff PUT replaces fields rather than patching them.
    if (currentTeacher.id !== id) {
      throw new Error("Cannot update teacher - current record ID mismatch");
    }

    // The person is written only when a name or the tag differs from the
    // record read: every person write moves its version, so an unchanged
    // name sent along would refuse the next save of the same form.
    if (this.personFieldsChanged(currentTeacher, teacherData)) {
      const person = await this.updatePersonRecord(currentTeacher, teacherData);
      options.onPersonSaved?.(person);
    }

    // Update staff record
    const staffData = this.buildStaffUpdateData(currentTeacher, teacherData);
    return this.updateStaffRecord(id, staffData);
  }

  /** Whether the update names a person field other than the record read. */
  private personFieldsChanged(
    currentTeacher: Teacher,
    teacherData: Partial<Teacher>,
  ): boolean {
    return (
      (teacherData.first_name !== undefined &&
        teacherData.first_name !== currentTeacher.first_name) ||
      (teacherData.last_name !== undefined &&
        teacherData.last_name !== currentTeacher.last_name) ||
      (teacherData.tag_id !== undefined &&
        (teacherData.tag_id ?? "") !== (currentTeacher.tag_id ?? ""))
    );
  }

  /** Updates person record for teacher */
  private async updatePersonRecord(
    currentTeacher: Teacher,
    teacherData: Partial<Teacher>,
  ): Promise<SavedPerson> {
    if (!currentTeacher.person_id) {
      throw new Error("Cannot update person fields - person_id not found");
    }

    // The exact digits the staff response carried — addressed as a path
    // segment, so it is checked to be a plain decimal id before it is spliced
    // into the URL.
    const personId = currentTeacher.person_id;
    if (!/^\d+$/.test(personId)) {
      throw new Error("Cannot update person fields - invalid person_id");
    }

    // The backend keeps the stored account link when account_id is omitted,
    // so the update names only the person fields (#2352).
    const personData = this.buildPersonUpdateData(teacherData);

    const saved = await bffJson("tenant", "PUT /api/users/{id}", {
      params: { id: personId },
      // The person as the form read it (ADR 0311).
      body: {
        ...personData,
        expected_version: currentTeacher.person_version ?? "",
      },
      errorMessage: "Failed to update person",
    });
    return {
      first_name: personData.first_name ?? currentTeacher.first_name,
      last_name: personData.last_name ?? currentTeacher.last_name,
      tag_id:
        personData.tag_id === undefined
          ? currentTeacher.tag_id
          : personData.tag_id || null,
      person_version: saved?.version,
    };
  }

  /** Builds person update payload from teacher data */
  private buildPersonUpdateData(
    teacherData: Partial<Teacher>,
  ): Pick<DirectoryPersonRequest, "first_name" | "last_name" | "tag_id"> {
    const personData: Pick<
      DirectoryPersonRequest,
      "first_name" | "last_name" | "tag_id"
    > = {};

    if (teacherData.first_name !== undefined) {
      personData.first_name = teacherData.first_name;
    }
    if (teacherData.last_name !== undefined) {
      personData.last_name = teacherData.last_name;
    }
    if (teacherData.tag_id !== undefined) {
      // Go reads null and "" alike for this field.
      personData.tag_id = teacherData.tag_id ?? "";
    }

    return personData;
  }

  /** Builds staff update data by merging partial update with current values */
  private buildStaffUpdateData(
    currentTeacher: Teacher,
    teacherData: Partial<Teacher>,
  ): StaffRequest {
    return {
      // The record as the form read it (ADR 0311): the unchanged fields
      // below come from that read, so the save rests on it.
      expected_version: currentTeacher.version ?? "",
      person_id: currentTeacher.person_id,
      // Den bestehenden Profil-Zustand erhalten, NIE hart true senden:
      // PUT /api/staff/{id} legt bei is_teacher=true eine fehlende
      // users.teachers-Zeile an — eine Lehrkraft (#1772, ohne
      // Betreuungsprofil) bekäme durch eine bloße Namenskorrektur sonst
      // stillschweigend eines.
      is_teacher:
        currentTeacher.is_teacher ?? Boolean(currentTeacher.teacher_id),
      staff_notes: this.mergeField(
        teacherData.staff_notes,
        currentTeacher.staff_notes,
      ),
      specialization: this.mergeField(
        teacherData.specialization,
        currentTeacher.specialization,
      ),
      role: this.mergeField(teacherData.role, currentTeacher.role),
      qualifications: this.mergeField(
        teacherData.qualifications,
        currentTeacher.qualifications,
      ),
    };
  }

  /** Merges update value with current value, trimming and defaulting to empty string */
  private mergeField(
    updateValue: string | null | undefined,
    currentValue: string | null | undefined,
  ): string {
    if (updateValue !== undefined) {
      return updateValue?.trim() ?? "";
    }
    return currentValue?.trim() ?? "";
  }

  /** Updates staff record via API */
  private async updateStaffRecord(
    id: string,
    staffData: StaffRequest,
  ): Promise<Teacher> {
    const staff = await bffJson("tenant", "PUT /api/staff/{id}", {
      params: { id },
      body: staffData,
      errorMessage: "Failed to update teacher",
    });
    return mapTeacherResponse(staff);
  }

  // Delete a teacher
  async deleteTeacher(id: string): Promise<void> {
    try {
      await bffJson("tenant", "DELETE /api/staff/{id}", {
        params: { id },
        errorMessage: "Failed to delete teacher",
      });
    } catch (error) {
      logger.error("error deleting teacher", {
        teacher_id: id,
        error: String(error),
      });
      throw error;
    }
  }
}

export const teacherService = new TeacherService();
