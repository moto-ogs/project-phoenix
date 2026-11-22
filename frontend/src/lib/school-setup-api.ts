import { ApiError, apiErrorFromResponse } from "./api-error";
import type { Status } from "./contract/school-setup.generated";
import { createLogger } from "./logger";
import { sessionFetch } from "./session-cache";

const logger = createLogger({ component: "SchoolSetupApi" });

/** Einrichtungs-Assistent für neue Schulen (#2832). */
export type SchoolSetupStepKey =
  "team" | "rooms" | "groups" | "students" | "guardians" | "worktime";

export interface SchoolSetupStep {
  key: SchoolSetupStepKey;
  /** Gilt der Schritt für diese Schule? */
  applies: boolean;
  done: boolean;
  skipped: boolean;
}

/** Die Einstellungen der Schule, von denen abhängt, welche Schritte gelten. */
interface SchoolSetupBasics {
  presenceMode: "detailed" | "binary";
  groupMode: "fixed_groups" | "open_care";
}

export interface SchoolSetupState {
  /** Die Schule hat die Einrichtung abgeschlossen. */
  completed: boolean;
  /** Diese Person hat den Assistenten ausgeblendet. */
  dismissed: boolean;
  basics: SchoolSetupBasics;
  steps: SchoolSetupStep[];
}

const STEP_KEYS: readonly SchoolSetupStepKey[] = [
  "team",
  "rooms",
  "groups",
  "students",
  "guardians",
  "worktime",
];

function isStepKey(key: string): key is SchoolSetupStepKey {
  return (STEP_KEYS as readonly string[]).includes(key);
}

export function mapSchoolSetupState(raw: Status): SchoolSetupState {
  return {
    completed: raw.completed,
    dismissed: raw.dismissed,
    basics: {
      presenceMode:
        raw.basics.presence_mode === "binary" ? "binary" : "detailed",
      groupMode:
        raw.basics.group_mode === "open_care" ? "open_care" : "fixed_groups",
    },
    steps: (raw.steps ?? []).flatMap((step) =>
      isStepKey(step.key)
        ? [
            {
              key: step.key,
              applies: step.applies,
              done: step.done,
              skipped: step.skipped,
            },
          ]
        : [],
    ),
  };
}

async function readState(response: Response, event: string) {
  if (!response.ok) {
    logger.error(event, { status: response.status });
    throw await apiErrorFromResponse(
      response,
      `school setup request failed (${response.status})`,
    );
  }
  const { data } = (await response.json()) as { data: Status };
  // Eine offene Einrichtung hat immer Schritte. Fehlen sie, ist die Antwort
  // nicht die erwartete; sie darf den Stand nicht ersetzen, sonst sähe die
  // Checkliste „alles erledigt“ (0 von 0).
  if (data.completed !== true && !Array.isArray(data.steps)) {
    logger.error(event, { reason: "unexpected_shape" });
    // Eine unbrauchbare Antwort ist ein Serverfehler, kein Eingabefehler.
    throw new ApiError("school setup response has an unexpected shape", 500);
  }
  return mapSchoolSetupState(data);
}

/**
 * Liest den Assistenten für die angemeldete Person. Ohne Recht (401/403)
 * gibt es keinen Assistenten: dann `null`.
 */
export async function fetchSchoolSetup(): Promise<SchoolSetupState | null> {
  const response = await sessionFetch("/api/school-setup", { method: "GET" });
  if (response.status === 401 || response.status === 403) {
    return null;
  }
  return readState(response, "fetch_school_setup_failed");
}

async function send(
  path: string,
  method: "PUT" | "POST",
  body: unknown,
  event: string,
): Promise<SchoolSetupState> {
  const response = await sessionFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return readState(response, event);
}

export function setSchoolSetupStepSkipped(
  step: SchoolSetupStepKey,
  skipped: boolean,
): Promise<SchoolSetupState> {
  return send(
    `/api/school-setup/steps/${step}`,
    "PUT",
    { skipped },
    "skip_school_setup_step_failed",
  );
}

export function completeSchoolSetup(): Promise<SchoolSetupState> {
  return send(
    "/api/school-setup/complete",
    "POST",
    undefined,
    "complete_school_setup_failed",
  );
}

export function setSchoolSetupDismissed(
  dismissed: boolean,
): Promise<SchoolSetupState> {
  return send(
    "/api/school-setup/dismissal",
    "PUT",
    { dismissed },
    "dismiss_school_setup_failed",
  );
}
