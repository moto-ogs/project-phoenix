import { answerWithoutEnvelope } from "~/lib/json-proxy.server";
import { school } from "~/lib/school/route-wrapper.server";

/**
 * Temporary (#2352): the portal's catalog proxy answers this path once this
 * file is gone (`../../mfa/[...path]`). It stays one release for an installed app
 * with an older bundle, which reads the bare device list; the backend
 * answers in the envelope now, and the current client reads both shapes.
 * Delete it after the next production deploy.
 */

export const GET = school.jsonProxy({
  method: "GET",
  onSuccess: answerWithoutEnvelope,
  path: "/school/auth/mfa/trusted-devices",
});
