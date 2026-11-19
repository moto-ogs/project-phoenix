import { answerWithoutEnvelope } from "~/lib/json-proxy.server";
import { createCatererJsonProxy } from "~/lib/caterer/route-wrapper.server";

/**
 * Temporary (#2352): the portal's catalog proxy answers this path once this
 * file is gone and `./[...path]` is renamed to `[[...path]]`, which matches
 * the path without a tail; Next refuses both beside this file. It stays one
 * release for an installed app with an older bundle, which reads the bare
 * passkey list; the backend answers in the envelope now, and the current
 * client reads both shapes. Delete it after the next production deploy.
 */

export const GET = createCatererJsonProxy({
  method: "GET",
  onSuccess: answerWithoutEnvelope,
  path: "/caterer/auth/passkeys",
});
