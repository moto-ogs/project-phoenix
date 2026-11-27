import type { Student } from "~/lib/student-helpers";
import { allowedModesIncludeAccompanied } from "~/lib/departure-plan";

/**
 * Validates data retention days field
 * @param retentionDays - The retention days value to validate
 * @returns Error message if invalid, undefined if valid
 */
function validateDataRetentionDays(
  retentionDays: number | null | undefined,
): string | undefined {
  if (retentionDays === null || retentionDays === undefined) {
    return "Bitte gib eine Zahl von 1 bis 31 ein.";
  }
  if (retentionDays < 1 || retentionDays > 31) {
    return "Bitte gib eine Zahl von 1 bis 31 ein.";
  }
  return undefined;
}

/** Hints for invalid fields of a new child, keyed by API field name. */
export function validateStudentForm(
  formData: Partial<Student>,
): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!formData.first_name?.trim()) {
    errors.first_name = "Bitte gib den Vornamen ein.";
  }
  if (!formData.second_name?.trim()) {
    errors.last_name = "Bitte gib den Nachnamen ein.";
  }
  if (!formData.school_class?.trim()) {
    errors.school_class = "Bitte gib die Klasse ein.";
  }

  // A form that leaves the consent pair out writes none, so there is
  // nothing to check.
  if ("data_retention_days" in formData) {
    const retentionError = validateDataRetentionDays(
      formData.data_retention_days,
    );
    if (retentionError) errors.data_retention_days = retentionError;
  }

  // A new child has no stored companion links; the note says who goes along.
  if (
    allowedModesIncludeAccompanied(
      formData.allowed_departure_modes,
      formData.departure_days,
    ) &&
    !formData.departure_companion_note?.trim()
  ) {
    errors.departure_companion_note =
      "Bitte gib an, mit wem das Kind nach Hause geht.";
  }

  return errors;
}
