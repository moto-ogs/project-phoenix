// This file contains the Teacher API service and related types

import { bffJson } from "./bff-fetch";
import type { DirectoryPersonRequest } from "./contract/users.generated";
import type { StaffRequest } from "./contract/staff.generated";
import { createLogger } from "~/lib/logger";
import { mapTeacherResponse } from "./teacher-helpers";
import type { Teacher } from "./teacher-types";

const logger = createLogger({ component: "TeacherAPI" });

// Define Teacher interface aligned with staff API response structure
export type { Teacher } from "./teacher-types";

/**
 * The person as a person write stored it: the record read with the written
 * fields and the version the write answered (undefined without an answer).
 */
export type SavedPerson = Readonly<
  Pick<Teacher, "first_name" | "last_name" | "tag_id" | "person_version">
>;

class TeacherService {
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
