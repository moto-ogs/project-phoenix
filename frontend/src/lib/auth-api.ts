import { transportFetch } from "./api-error";
import { buildApiError } from "./api-error-response";
import { portalAuthPath, type PasswordResetPortal } from "./portal-paths";

/** Asks the portal to e-mail a reset link; the link lands on its own host. */
export async function requestPasswordReset(
  portal: PasswordResetPortal,
  email: string,
): Promise<void> {
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
}

/** Sets the new password with the token from the portal's reset link. */
export async function confirmPasswordReset(
  portal: PasswordResetPortal,
  token: string,
  password: string,
  confirmPassword: string,
): Promise<void> {
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
}
