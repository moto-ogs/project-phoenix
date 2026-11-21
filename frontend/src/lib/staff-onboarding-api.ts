import { ApiError, apiErrorFromResponse } from "./api-error";
import type {
  PutStaffOnboardingDismissalQuery,
  StaffStatus,
} from "./contract/staff-onboarding.generated";
import { createLogger } from "./logger";
import { sessionFetch } from "./session-cache";

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

async function readState(
  response: Response,
  event: string,
): Promise<StaffOnboardingState> {
  if (!response.ok) {
    logger.error(event, { status: response.status });
    throw await apiErrorFromResponse(
      response,
      `staff onboarding request failed (${response.status})`,
    );
  }
  const { data } = (await response.json()) as { data: StaffStatus };
  // Ohne die beiden Listen ist die Antwort nicht die erwartete. Sie darf den
  // Stand nicht ersetzen, sonst stünde jeder Schritt wieder offen.
  if (!Array.isArray(data.done_steps) || !Array.isArray(data.skipped_steps)) {
    logger.error(event, { reason: "unexpected_shape" });
    // Eine unbrauchbare Antwort ist ein Serverfehler, kein Eingabefehler.
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
  const response = await sessionFetch("/api/staff-onboarding", {
    method: "GET",
  });
  if (response.status === 401 || response.status === 403) {
    return null;
  }
  return readState(response, "fetch_staff_onboarding_failed");
}

async function put(
  path: string,
  body: unknown,
  event: string,
): Promise<StaffOnboardingState> {
  const response = await sessionFetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readState(response, event);
}

export function setStaffOnboardingStepState(
  step: StaffOnboardingStepKey,
  state: StaffOnboardingStepState,
): Promise<StaffOnboardingState> {
  return put(
    `/api/staff-onboarding/steps/${step}`,
    { state },
    "set_staff_onboarding_step_failed",
  );
}

/**
 * Blendet die Checkliste aus. `completed` heißt: die Person hat sie über
 * „Abschließen“ beendet, nicht vorher über „Ausblenden“. Das liest nur die
 * Nutzungsanalyse der Schule (#7553); gespeichert wird beides gleich.
 */
export function setStaffOnboardingDismissed(
  dismissed: boolean,
  options: { completed?: boolean } = {},
): Promise<StaffOnboardingState> {
  const query: PutStaffOnboardingDismissalQuery = options.completed
    ? { outcome: "completed" }
    : {};
  const search = query.outcome ? `?outcome=${query.outcome}` : "";
  return put(
    `/api/staff-onboarding/dismissal${search}`,
    { dismissed },
    "dismiss_staff_onboarding_failed",
  );
}
