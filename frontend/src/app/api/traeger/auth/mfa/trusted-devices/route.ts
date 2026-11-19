import { answerWithoutEnvelope } from "~/lib/json-proxy.server";
import { traeger } from "~/lib/traeger/route-wrapper.server";

/**
 * Temporary (#2352): the portal's catalog proxy answers this path once this
 * file is gone (`../../mfa/[...path]`). It stays one release for an installed app
 * with an older bundle, which reads the bare device list; the backend
 * answers in the envelope now, and the current client reads both shapes.
 * Delete it after the next production deploy.
 */

export const GET = traeger.jsonProxy({
  method: "GET",
  onSuccess: answerWithoutEnvelope,
  path: "/traeger/auth/mfa/trusted-devices",
});
