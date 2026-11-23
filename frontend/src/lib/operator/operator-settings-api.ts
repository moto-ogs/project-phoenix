import { bffJson } from "~/lib/bff-fetch";
import { ApiError } from "../api-error";
import { toSettingsSchema, type SettingsSchema } from "~/lib/settings-api";
import { createLogger } from "~/lib/logger";
import type * as operatorSchoolsContract from "~/lib/contract/operator-schools.generated";

const logger = createLogger({ component: "OperatorSettingsApi" });

interface BookingAuthorityImpactChild {
  studentId: string;
  firstName: string;
  lastName: string;
  schoolClass: string;
  firstBookinglessDay?: string;
}

export interface BookingAuthorityImpact {
  referenceDate: string | null;
  blockingChildren: BookingAuthorityImpactChild[];
  plannedCompletions: BookingAuthorityImpactChild[];
}

export async function fetchBookingAuthorityImpact(
  schoolId: string,
): Promise<BookingAuthorityImpact> {
  const wire = await bffJson(
    "platform",
    "GET /operator/schools/{id}/settings/booking-authority-impact",
    { params: { id: schoolId } },
  );
  return {
    referenceDate: wire.reference_date,
    blockingChildren: (wire.blocking_children ?? []).map(mapImpactChild),
    plannedCompletions: (wire.planned_completions ?? []).map(mapImpactChild),
  };
}

function mapImpactChild(
  child: operatorSchoolsContract.BookingAuthorityImpactChild,
): BookingAuthorityImpactChild {
  return {
    studentId: child.student_id,
    firstName: child.first_name,
    lastName: child.last_name,
    schoolClass: child.school_class,
    firstBookinglessDay: child.first_bookingless_day,
  };
}

/**
 * Fetch the settings schema for a specific school.
 * Operators see all settings regardless of per-setting permissions. Every
 * failure throws, an unknown school too, so the page shows it (#2519).
 */
export async function fetchOperatorSettingsSchema(
  schoolId: string,
): Promise<SettingsSchema> {
  try {
    return toSettingsSchema(
      await bffJson("platform", "GET /operator/schools/{id}/settings/schema", {
        params: { id: schoolId },
      }),
    );
  } catch (error) {
    logger.error("fetch_operator_settings_schema_failed", {
      school_id: schoolId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Set a setting value for a school. Throws the ApiError of a failed save,
 * which the settings field shows on the shared error path (#2519).
 */
export async function setOperatorSettingValue(
  schoolId: string,
  key: string,
  value: unknown,
): Promise<void> {
  try {
    // The route file purges the school's cached tenant lookup after the
    // write, so the school's login page shows the change.
    await bffJson(
      "platform",
      "PUT /operator/schools/{id}/settings/values/{key}",
      {
        params: { id: schoolId, key },
        body: { value },
      },
    );
  } catch (error) {
    logger.warn("set_operator_setting_value_failed", {
      school_id: schoolId,
      key,
      status: error instanceof ApiError ? error.status : undefined,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/** Reset a setting value for a school. Throws the ApiError of a failure. */
export async function resetOperatorSettingValue(
  schoolId: string,
  key: string,
): Promise<void> {
  try {
    await bffJson(
      "platform",
      "DELETE /operator/schools/{id}/settings/values/{key}",
      { params: { id: schoolId, key } },
    );
  } catch (error) {
    logger.warn("reset_operator_setting_value_failed", {
      school_id: schoolId,
      key,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Reveal the unmasked value of a password/PIN setting for a school.
 * Returns null when the setting holds no text value; a failed request throws.
 */
export async function revealOperatorSettingValue(
  schoolId: string,
  key: string,
): Promise<string | null> {
  const result = await bffJson(
    "platform",
    "GET /operator/schools/{id}/settings/values/{key}/reveal",
    { params: { id: schoolId, key } },
  );
  return typeof result.value === "string" ? result.value : null;
}

// --- Träger-Einstellungen im Operator-Dashboard (#5748) ---

/**
 * The settings of one Träger, as the Träger portal shows them: only settings
 * with the levels `beide` or `traeger`, each writable for the operator.
 * Every failure throws, so the tab shows it.
 */
export async function fetchOperatorTraegerSettingsSchema(
  organizationId: string,
): Promise<SettingsSchema> {
  return toSettingsSchema(
    await bffJson(
      "platform",
      "GET /operator/organizations/{id}/traeger-settings/schema",
      { params: { id: organizationId } },
    ),
  );
}

/** Sets the Träger value of one setting. Throws the ApiError of a failure. */
export async function setOperatorTraegerSettingValue(
  organizationId: string,
  key: string,
  value: unknown,
): Promise<void> {
  try {
    await bffJson(
      "platform",
      "PUT /operator/organizations/{id}/traeger-settings/values/{key}",
      { params: { id: organizationId, key }, body: { value } },
    );
  } catch (error) {
    logger.warn("set_operator_traeger_setting_value_failed", {
      organization_id: organizationId,
      key,
      status: error instanceof ApiError ? error.status : undefined,
    });
    throw error;
  }
}

/**
 * Removes the Träger value of one setting: the schools fall back to the
 * default or keep their own value. Throws the ApiError of a failure.
 */
export async function resetOperatorTraegerSettingValue(
  organizationId: string,
  key: string,
): Promise<void> {
  try {
    await bffJson(
      "platform",
      "DELETE /operator/organizations/{id}/traeger-settings/values/{key}",
      { params: { id: organizationId, key } },
    );
  } catch (error) {
    logger.warn("reset_operator_traeger_setting_value_failed", {
      organization_id: organizationId,
      key,
      status: error instanceof ApiError ? error.status : undefined,
    });
    throw error;
  }
}
