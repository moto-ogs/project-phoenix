// The privacy consent of a student around a student write. Student Presence
// owns the consent at its own endpoint, so the browser writes it beside the
// student and reads it back afterwards; without a stored one the backend
// answers with the school's defaults (gdpr.privacy_consent_retention_days).

import { ApiError } from "./api-error";
import { bffJson } from "./bff-fetch";
import { createLogger } from "./logger";
import type { Student } from "./student-helpers";

const logger = createLogger({ component: "StudentPrivacyConsent" });

/**
 * A form sends the pair only when the person changed it, with the version of
 * the consent read it shows (`privacy_consent_version`, ADR 0311).
 */
export type ConsentPairInput = Pick<
  Student,
  "privacy_consent_accepted" | "data_retention_days" | "privacy_consent_version"
>;

/**
 * The two consent fields a student form edits. `data_retention_days` is null
 * only as the form holds an emptied field; the backend refuses it.
 */
export type ConsentPair = Required<
  Pick<ConsentPairInput, "privacy_consent_accepted" | "data_retention_days">
>;

// The policy version the backend states as its default
// (studentpresence defaultPrivacyPolicyVersion).
const POLICY_VERSION = "1.0";

/**
 * The pair a write carries, or null when it carries neither field. The
 * backend write is a full upsert, so a lone field would silently reset the
 * other; a form that sends one without the other is a programming error.
 */
export function sentConsentPair(body: ConsentPairInput): ConsentPair | null {
  const { privacy_consent_accepted, data_retention_days } = body;
  if (
    privacy_consent_accepted === undefined &&
    data_retention_days === undefined
  )
    return null;
  if (
    privacy_consent_accepted === undefined ||
    data_retention_days === undefined
  )
    throw new TypeError(
      "privacy_consent_accepted and data_retention_days are sent together",
    );
  return { privacy_consent_accepted, data_retention_days };
}

/**
 * Writes the pair against the consent read the form shows: `expectedVersion`
 * is that read's version, and the backend refuses the write with
 * `general.changed_since_read` when the stored consent changed since.
 */
export async function writeStudentConsent(
  studentId: string,
  pair: ConsentPair,
  expectedVersion: string | undefined,
): Promise<void> {
  await bffJson("tenant", "PUT /api/students/{id}/privacy-consent", {
    params: { id: studentId },
    body: {
      expected_version: expectedVersion,
      policy_version: POLICY_VERSION,
      accepted: pair.privacy_consent_accepted,
      // Go reads null and an absent key alike and refuses the empty value.
      data_retention_days: pair.data_retention_days ?? undefined,
    },
  });
}

/**
 * The version of a child's consent as stored now. A new child has none
 * recorded yet; its first consent is written against that state.
 */
export async function readStudentConsentVersion(
  studentId: string,
): Promise<string> {
  const consent = await bffJson(
    "tenant",
    "GET /api/students/{id}/privacy-consent",
    { params: { id: studentId } },
  );
  return consent.version;
}

/**
 * The stored consent, or the school's defaults when none is stored. Null when
 * the caller may not read it (403): the form then keeps what it holds.
 */
async function readStudentConsent(
  studentId: string,
): Promise<ConsentPair | null> {
  try {
    const consent = await bffJson(
      "tenant",
      "GET /api/students/{id}/privacy-consent",
      { params: { id: studentId } },
    );
    return {
      privacy_consent_accepted: consent.accepted,
      data_retention_days: consent.data_retention_days,
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return null;
    throw error;
  }
}

/**
 * The consent read back after a student write. Everything is committed by
 * then, so an unreadable consent must not turn the write into a failure: the
 * pair just written stands in, and with nothing written the keys stay out and
 * the form keeps the consent it holds.
 */
export async function readConsentAfterWrite(
  studentId: string,
  written: ConsentPair | null,
): Promise<ConsentPair | null> {
  try {
    return await readStudentConsent(studentId);
  } catch (error) {
    logger.warn("privacy_consent_read_back_failed", {
      student_id: studentId,
      error: error instanceof Error ? error.message : String(error),
    });
    return written;
  }
}
