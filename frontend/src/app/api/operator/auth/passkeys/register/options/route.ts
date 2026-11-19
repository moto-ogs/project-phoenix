import { answerWithoutEnvelope } from "~/lib/json-proxy.server";
import { createOperatorJsonProxy } from "~/lib/operator/route-wrapper.server";

/**
 * Temporary (#2352): the portal's catalog proxy answers this path once this
 * file is gone (`../../[...path]`). It stays one release for an installed app
 * with an older bundle, which reads the bare ceremony options; the backend
 * answers in the envelope now, and the current client reads both shapes.
 * Delete it after the next production deploy.
 */

export const POST = createOperatorJsonProxy({
  method: "POST",
  onSuccess: answerWithoutEnvelope,
  path: "/operator/auth/passkeys/register/options",
  body: "optional-json",
});
