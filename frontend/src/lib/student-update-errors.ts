// The refusals of the student update that the forms answer differently from a
// plain failure: the companion-plan question, the stale "läuft mit" list, the
// stranded linked child, and the half-saved privacy consent. Each arrives as
// the ApiError of updateStudent (~/lib/student-api). Keyed off the code, never
// the status: the student PUT answers 409 and 400 for several reasons.

import {
  ApiError,
  enrichApiError,
  isProblemRecord,
  problemDetail,
} from "./api-error";
import { knownEnum } from "./contract/known-enum";
import { CompanionConflictDetailsSchema } from "./contract/problem-details.generated";
import {
  ALL_COMPANION_WEEKDAYS,
  type CompanionExtensionConfirmation,
} from "./student-companion-api";

/**
 * The conflict list of a 409 body in the confirmation shape. Anything
 * unparsable yields an empty list, which makes the retry ask again rather than
 * confirm something we could not read.
 */
function conflictExtensions(body: unknown): CompanionExtensionConfirmation[] {
  if (
    !isProblemRecord(body) ||
    body.code !== "students.companion_plan_conflict"
  ) {
    return [];
  }
  const parsed = CompanionConflictDetailsSchema.safeParse(body.details);
  if (!parsed.success) return [];
  const confirmations: CompanionExtensionConfirmation[] = [];
  for (const conflict of parsed.data.conflicts ?? []) {
    const days = conflict.weekdays?.map((day) =>
      knownEnum(ALL_COMPANION_WEEKDAYS, day),
    );
    if (!days?.length || !days.every((day) => day !== undefined)) return [];
    confirmations.push({
      companion_student_id: conflict.student_id,
      weekdays: days,
    });
  }
  return confirmations;
}

/**
 * Raised when a student update was refused because a linked child's own
 * departure plan does not yet allow leaving with another child on the
 * requested days. Nothing was written; re-send with extend_companion_plans
 * after the user confirms.
 */
export class CompanionPlanConflictError extends ApiError {
  /**
   * The conflicting children and weekdays exactly as the backend reported them.
   * The confirmation has to name them again on the retry, so the backend can
   * tell "the user agreed to this" apart from "this appeared afterwards".
   */
  readonly conflicts: CompanionExtensionConfirmation[];

  constructor(body: unknown) {
    super(problemDetail(body)?.trim() ?? "companion plan conflict", 409);
    // Keep the original error's code and details.
    enrichApiError(this, body, 409);
    this.name = "CompanionPlanConflictError";
    this.conflicts = conflictExtensions(body);
  }
}

/**
 * Whether a complete 409 body is the companion-plan question. Strict on
 * purpose: the student PUT answers 409 for several unrelated reasons
 * (students.companion_lock_busy, students.sick_excused_conflict, …), and typing
 * one of those as the question would replace its real contract with an empty
 * confirmation the user cannot answer.
 */
export function isCompanionPlanConflictResponse(body: unknown): boolean {
  return conflictExtensions(body).length > 0;
}

/**
 * The submitted "läuft mit" list was built on a snapshot someone else has
 * since replaced. Re-sending the SAME list is exactly what the refusal
 * prevents, so the form reloads first and lets the user redo the edit. This
 * is the code an older backend still in service answers; the current one
 * answers general.changed_since_read (ADR 0311), which the form handles
 * before it, with isChangedSinceRead.
 */
export function isCompanionsChanged(err: unknown): boolean {
  return err instanceof ApiError && err.code === "students.companions_changed";
}

/**
 * Removing a link would leave the linked child with an accompanied departure
 * plan and no note and no other link. Nothing to confirm: the user has to fix
 * that child's Heimweg first.
 */
export function isCompanionDepartureRefusal(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.code === "students.companion_would_lose_departure"
  );
}

const consentSavedBeforeRefusal = new WeakSet<ApiError>();

/** Marks browser-local write progress without changing the Go refusal. */
export function markPrivacyConsentSaved(error: unknown): unknown {
  if (error instanceof ApiError) consentSavedBeforeRefusal.add(error);
  return error;
}

/**
 * The student PUT writes the privacy consent first, against another backend
 * endpoint and transaction. When the student write then fails, the consent is
 * stored and the rest is not; the route marks that error so the form can say
 * which half landed instead of inviting the user to abandon the retry.
 */
export function isPrivacyConsentSaved(err: unknown): boolean {
  return err instanceof ApiError && consentSavedBeforeRefusal.has(err);
}
