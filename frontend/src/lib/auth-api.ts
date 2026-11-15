// lib/auth-api.ts
import { ApiError, apiErrorFromBody, transportFetch } from "./api-error";
import { portalAuthPath, type PortalKey } from "./portal-paths";
export { handleAuthFailure, refreshToken } from "./auth-failure";
import { createLogger } from "~/lib/logger";
import { parseRetryAfter } from "./retry-after";

export type { ApiError } from "./api-error";

const logger = createLogger({ component: "AuthAPI" });

export async function buildApiError(
  response: Response,
  fallbackMessage: string,
): Promise<ApiError> {
  let message = fallbackMessage;
  let payload: unknown;

  try {
    const contentType = response.headers.get("Content-Type") ?? "";
    if (
      contentType.includes("application/json") ||
      contentType.includes("+json")
    ) {
      // The envelope's `detail` becomes the diagnostic message.
      payload = await response.json();
    } else {
      const text = (await response.text()).trim();
      if (text) {
        message = text;
      }
    }
  } catch (parseError) {
    logger.warn("failed to parse error response", {
      error: String(parseError),
    });
  }

  const apiError = apiErrorFromBody(message, response.status, payload);

  const retryAfter = parseRetryAfter(response.headers.get("Retry-After"));
  if (retryAfter !== null) {
    apiError.retryAfterSeconds = retryAfter;
  }

  return apiError;
}

/** A portal with a "Passwort vergessen?": every portal but the operator's. */
export type PasswordResetPortal = Exclude<PortalKey, "operator">;

/** Asks the portal to e-mail a reset link; the link lands on its own host. */
export async function requestPasswordReset(
  portal: PasswordResetPortal,
  email: string,
): Promise<{ message: string }> {
  const response = await transportFetch(
    portalAuthPath(portal, "password-reset"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    },
  );
  if (!response.ok) {
    throw await buildApiError(
      response,
      "Fehler beim Senden der Passwort-Zurücksetzen-E-Mail",
    );
  }
  return (await response.json()) as { message: string };
}

/** Sets the new password with the token from the portal's reset link. */
export async function confirmPasswordReset(
  portal: PasswordResetPortal,
  token: string,
  password: string,
  confirmPassword: string,
): Promise<{ message: string }> {
  const response = await transportFetch(
    portalAuthPath(portal, "password-reset/confirm"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        new_password: password,
        confirm_password: confirmPassword,
      }),
    },
  );
  if (!response.ok) {
    throw await buildApiError(
      response,
      "Fehler beim Zurücksetzen des Passworts",
    );
  }
  return (await response.json()) as { message: string };
}
