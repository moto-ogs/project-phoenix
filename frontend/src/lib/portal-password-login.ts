// The password step of a portal whose BFF installs the session itself and
// whose account may have a voluntary second factor: the caterer portal
// (#4497) and the parents portal (#7051). The browser learns only whether a
// second step follows. A refusal comes back as an ApiError with its code.

import { bffJsonUncontracted } from "./bff-fetch";
import { portalAuthPath } from "./portal-paths";
import { signInAnswer, type SignInAnswer } from "./sign-in-answer";

/** The caterer's and the parents' sign-in never asks for a setup step. */
export type PortalPasswordLoginResult = Extract<
  SignInAnswer,
  { status: "authenticated" | "mfa_required" }
>;

export async function portalPasswordLogin(
  portal: "caterer" | "parent",
  email: string,
  password: string,
): Promise<PortalPasswordLoginResult> {
  // A sign-in step of the BFF without a session (`public`). The
  // trusted-device cookie of this browser travels along (same origin), so a
  // remembered device skips the code.
  const answer = signInAnswer(
    portal,
    await bffJsonUncontracted<unknown>(
      "public",
      "POST",
      portalAuthPath(portal, "login"),
      { body: { email, password }, errorMessage: `${portal} login failed` },
    ),
  );
  return answer.status === "mfa_required"
    ? answer
    : { status: "authenticated" };
}
