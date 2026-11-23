import { bffJson } from "./bff-fetch";
import type { PasswordResetPortal } from "./portal-paths";

// The reset routes run without a session (`public`); each portal has its own
// pair under its BFF prefix, so the link lands on the portal's own host.
const RESET_ROUTES = {
  tenant: {
    request: "POST /auth/password-reset",
    confirm: "POST /auth/password-reset/confirm",
  },
  parent: {
    request: "POST /parent/auth/password-reset",
    confirm: "POST /parent/auth/password-reset/confirm",
  },
  school: {
    request: "POST /school/auth/password-reset",
    confirm: "POST /school/auth/password-reset/confirm",
  },
  caterer: {
    request: "POST /caterer/auth/password-reset",
    confirm: "POST /caterer/auth/password-reset/confirm",
  },
  traeger: {
    request: "POST /traeger/auth/password-reset",
    confirm: "POST /traeger/auth/password-reset/confirm",
  },
} as const satisfies Record<
  PasswordResetPortal,
  { request: string; confirm: string }
>;

/** Asks the portal to e-mail a reset link; the link lands on its own host. */
export async function requestPasswordReset(
  portal: PasswordResetPortal,
  email: string,
): Promise<void> {
  await bffJson("public", RESET_ROUTES[portal].request, {
    body: { email },
    errorMessage: "Fehler beim Senden der Passwort-Zurücksetzen-E-Mail",
  });
}

/** Sets the new password with the token from the portal's reset link. */
export async function confirmPasswordReset(
  portal: PasswordResetPortal,
  token: string,
  password: string,
  confirmPassword: string,
): Promise<void> {
  await bffJson("public", RESET_ROUTES[portal].confirm, {
    body: {
      token,
      new_password: password,
      confirm_password: confirmPassword,
    },
    errorMessage: "Fehler beim Zurücksetzen des Passworts",
  });
}
