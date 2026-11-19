import { answerWithoutEnvelope } from "~/lib/json-proxy.server";
import { createParentJsonProxy } from "~/lib/parent/route-wrapper.server";

// The parents' sign-in with a code (#7051): whether it is on, switching it on
// with an e-mailed code and switching it off with the password.

/**
 * Temporary (#2352): the portal's catalog proxy answers this path once this file
 * is gone. It stays one release for an installed app with an older bundle,
 * which reads the bare second-factor state; the backend answers in the envelope now, and the
 * current client reads both shapes. Delete it after the next production
 * deploy.
 */

export const GET = createParentJsonProxy({
  method: "GET",
  onSuccess: answerWithoutEnvelope,
  path: "/parent/me/mfa",
});
