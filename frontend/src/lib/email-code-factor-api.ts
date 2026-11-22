// Client-side API of a second factor a person switches on in their own
// account: the caterer's (#4497) and the parents' (#7051).

import { bffJson, bffJsonUncontracted } from "./bff-fetch";

/** The second factor as the account settings show it. */
interface EmailCodeFactorStatus {
  enabled: boolean;
  /**
   * False when the factor cannot be switched on for this account. Only the
   * parents portal sends it (an account that is a parent at no school); the
   * caterer's factor is always available, so a missing value reads as true.
   */
  available: boolean;
  maskedEmail: string;
}

export interface EmailCodeFactorApi {
  status(): Promise<EmailCodeFactorStatus>;
  /** Mails the code that switches the factor on. */
  start(): Promise<{ challengeToken: string; maskedEmail: string }>;
  /**
   * Switches the factor on with the mailed code. The backend answers with a
   * new session with the factor proven, which the BFF installs, because the
   * older sessions of the account lose access at their next renewal.
   * `sessionRenewed` is false when the code was right but the new session
   * could not be installed.
   */
  confirm(
    challengeToken: string,
    code: string,
  ): Promise<{ sessionRenewed: boolean }>;
  /** Switches the factor off after checking the current password. */
  disable(currentPassword: string): Promise<void>;
}

/** The factor of the caterer's account (#4497). */
const catererFactor: EmailCodeFactorApi = {
  async status() {
    const data = await bffJson("caterer", "GET /caterer/account/mfa");
    // The caterer's factor is always available.
    return {
      enabled: data.enabled,
      available: true,
      maskedEmail: data.masked_email,
    };
  },
  async start() {
    const data = await bffJson("caterer", "POST /caterer/account/mfa/start");
    return {
      challengeToken: data.challenge_token,
      maskedEmail: data.masked_email,
    };
  },
  confirm: (challengeToken, code) =>
    confirmFactor(
      "caterer",
      "/api/caterer/account/mfa/confirm",
      challengeToken,
      code,
    ),
  async disable(currentPassword) {
    await bffJson("caterer", "POST /caterer/account/mfa/disable", {
      body: { current_password: currentPassword },
    });
  },
};

/** The factor of a parent account (#7051). */
const parentFactor: EmailCodeFactorApi = {
  async status() {
    const data = await bffJson("parent", "GET /parent/me/mfa");
    return {
      enabled: data.enabled,
      available: data.available,
      maskedEmail: data.masked_email,
    };
  },
  async start() {
    const data = await bffJson("parent", "POST /parent/me/mfa/start");
    return {
      challengeToken: data.challenge_token,
      maskedEmail: data.masked_email,
    };
  },
  confirm: (challengeToken, code) =>
    confirmFactor("parent", "/api/parent/me/mfa/confirm", challengeToken, code),
  async disable(currentPassword) {
    await bffJson("parent", "POST /parent/me/mfa/disable", {
      body: { current_password: currentPassword },
      authRefusals: ["identity.current_password_wrong"],
    });
  },
};

// The confirm step installs the renewed session in its own route.ts
// (createFactorConfirmRoute), so it has no catalog contract.
async function confirmFactor(
  portal: "caterer" | "parent",
  path: string,
  challengeToken: string,
  code: string,
): Promise<{ sessionRenewed: boolean }> {
  const data = await bffJsonUncontracted<{ session_renewed: boolean }>(
    portal,
    "POST",
    path,
    {
      body: { challenge_token: challengeToken, code },
      authRefusals: ["identity.mfa_code_invalid"],
    },
  );
  return { sessionRenewed: data.session_renewed };
}

/** The factor's calls of the portal. */
export function emailCodeFactorApi(
  portal: "caterer" | "parent",
): EmailCodeFactorApi {
  return portal === "caterer" ? catererFactor : parentFactor;
}
