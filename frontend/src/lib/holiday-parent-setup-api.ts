// Elternkonto aus dem Link der Ferienanmeldung (#6673, ADR 0216). Der Link
// ist die Berechtigung; er gilt 30 Tage und nur für diese Seite.

import { bffJson } from "~/lib/bff-fetch";

export interface HolidayParentSetup {
  /** The address the link went to; the account's login. */
  readonly email: string;
  readonly traegerName: string;
  /** The address already has an account: no password is set here. */
  readonly accountExists: boolean;
}

export async function fetchHolidayParentSetup(
  token: string,
): Promise<HolidayParentSetup> {
  const data = await bffJson(
    "public",
    "GET /auth/holiday-parent-setups/{token}",
    {
      params: { token },
      errorMessage: "Elternkonto konnte nicht geladen werden",
    },
  );
  return {
    email: data.email,
    traegerName: data.traeger_name,
    accountExists: data.account_exists,
  };
}

/**
 * Sets the password of a new account, or, without one, only adds the
 * access at the Träger to the account that exists. Answers whether the
 * account existed.
 */
export async function completeHolidayParentSetup(
  token: string,
  passwords?: { password: string; confirmPassword: string },
): Promise<{ accountExists: boolean }> {
  const data = await bffJson(
    "public",
    "POST /auth/holiday-parent-setups/{token}",
    {
      params: { token },
      body: passwords
        ? {
            password: passwords.password,
            confirm_password: passwords.confirmPassword,
          }
        : {},
      errorMessage: "Elternkonto konnte nicht eingerichtet werden",
    },
  );
  return { accountExists: data.account_exists };
}
