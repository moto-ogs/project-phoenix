import { ApiError } from "./api-error";
import { bffJson } from "./bff-fetch";
import type { StaffStatus } from "./contract/staff-onboarding.generated";
import { createLogger } from "./logger";

const logger = createLogger({ component: "StaffOnboardingApi" });

/** Die ersten Schritte einer Betreuungskraft (#3748). */
export type StaffOnboardingStepKey =
  | "groups"
  | "students"
  | "attendance"
  | "calendar"
  | "supervision"
  | "work_time";

export const STAFF_ONBOARDING_STEP_KEYS: readonly StaffOnboardingStepKey[] = [
  "groups",
  "students",
  "attendance",
  "calendar",
  "supervision",
  "work_time",
];

export type StaffOnboardingStepState = "open" | "done" | "skipped";

export interface StaffOnboardingState {
  /** Diese Person hat die Checkliste ausgeblendet. */
  dismissed: boolean;
  /** Die Schule hat eine Gruppe oder ein Kind; vorher zeigten die Touren leere Seiten. */
  schoolReady: boolean;
  doneSteps: readonly StaffOnboardingStepKey[];
  skippedSteps: readonly StaffOnboardingStepKey[];
}

function stepKeys(raw: readonly string[] | null): StaffOnboardingStepKey[] {
  return (raw ?? []).filter((key): key is StaffOnboardingStepKey =>
    STAFF_ONBOARDING_STEP_KEYS.includes(key as StaffOnboardingStepKey),
  );
}

export function mapStaffOnboardingState(
  raw: StaffStatus,
): StaffOnboardingState {
  return {
    dismissed: raw.dismissed,
    schoolReady: raw.school_ready,
    doneSteps: stepKeys(raw.done_steps),
    skippedSteps: stepKeys(raw.skipped_steps),
  };
}

/** Runs a call of the checklist; a failure is logged under its event. */
async function readState(
  call: Promise<StaffStatus>,
  event: string,
): Promise<StaffOnboardingState> {
  let data: StaffStatus;
  try {
    data = await call;
  } catch (error) {
    logger.error(event, {
      status: error instanceof ApiError ? error.status : undefined,
    });
    throw error;
  }
  // Ohne die beiden Listen ist die Antwort nicht die erwartete. Sie darf den
  // Stand nicht ersetzen, sonst stünde jeder Schritt wieder offen.
  if (!Array.isArray(data.done_steps) || !Array.isArray(data.skipped_steps)) {
    logger.error(event, { reason: "unexpected_shape" });
    throw new ApiError(
      "staff onboarding response has an unexpected shape",
      500,
    );
  }
  return mapStaffOnboardingState(data);
}

/**
 * Liest die ersten Schritte der angemeldeten Person. Ohne Konto in der Schule
 * (401/403) gibt es keine Checkliste: dann `null`.
 */
export async function fetchStaffOnboarding(): Promise<StaffOnboardingState | null> {
  try {
    return await readState(
      bffJson("tenant", "GET /api/staff-onboarding/"),
      "fetch_staff_onboarding_failed",
    );
  } catch (error) {
    if (
      error instanceof ApiError &&
      (error.status === 401 || error.status === 403)
    ) {
      return null;
    }
    throw error;
  }
}

export function setStaffOnboardingStepState(
  step: StaffOnboardingStepKey,
  state: StaffOnboardingStepState,
): Promise<StaffOnboardingState> {
  return readState(
    bffJson("tenant", "PUT /api/staff-onboarding/steps/{step}", {
      params: { step },
      body: { state },
    }),
    "set_staff_onboarding_step_failed",
  );
}

/**
 * Blendet die Checkliste aus. `completed` heißt: die Person hat sie über
 * „Abschließen“ beendet, nicht vorher über „Ausblenden“. Das liest nur die
 * Nutzungsanalyse der Schule (#7553); gespeichert wird beides gleich.
 */
export function dismissStaffOnboarding(
  options: { completed?: boolean } = {},
): Promise<StaffOnboardingState> {
  return readState(
    bffJson("tenant", "PUT /api/staff-onboarding/dismissal", {
      query: { outcome: options.completed ? "completed" : undefined },
      body: { dismissed: true },
    }),
    "dismiss_staff_onboarding_failed",
  );
}
