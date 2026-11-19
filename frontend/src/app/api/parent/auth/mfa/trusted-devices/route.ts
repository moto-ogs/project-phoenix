import { answerWithoutEnvelope } from "~/lib/json-proxy.server";
import { createParentJsonProxy } from "~/lib/parent/route-wrapper.server";

// The devices the parents portal remembered (#7051), read with the parent
// session. The shared device card reads every portal's list under its
// auth path; the parents portal keeps it with the account's settings.
/**
 * Temporary (#2352): the portal's catalog proxy answers `/api/parent/me/mfa/trusted-devices`, the backend path the current client reads, once this file
 * is gone. It stays one release for an installed app with an older bundle,
 * which reads the bare device list; the backend answers in the envelope now, and the
 * current client reads both shapes. Delete it after the next production
 * deploy.
 */

export const GET = createParentJsonProxy({
  method: "GET",
  onSuccess: answerWithoutEnvelope,
  path: "/parent/me/mfa/trusted-devices",
});
