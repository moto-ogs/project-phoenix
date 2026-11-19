import { answerWithoutEnvelope } from "~/lib/json-proxy.server";
import { createCatererJsonProxy } from "~/lib/caterer/route-wrapper.server";

/**
 * Temporary (#2352): the portal's catalog proxy answers this path once this file
 * is gone. It stays one release for an installed app with an older bundle,
 * which reads the bare challenge; the backend answers in the envelope now, and the
 * current client reads both shapes. Delete it after the next production
 * deploy.
 */

export const POST = createCatererJsonProxy({
  method: "POST",
  onSuccess: answerWithoutEnvelope,
  retry: { off: "a renewed session would mail the code twice" },
  path: "/caterer/account/mfa/start",
});
