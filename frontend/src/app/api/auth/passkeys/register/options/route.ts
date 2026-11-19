import { answerWithoutEnvelope } from "~/lib/json-proxy.server";
import { createTenantJsonProxy } from "~/lib/route-wrapper.server";

/**
 * Temporary (#2352): the staff portal's catalog proxy answers this path once
 * this file is gone. It stays one release for an installed app with an older
 * bundle, which reads the bare ceremony options; the backend answers in the envelope now,
 * and the current client reads both shapes. Delete it after the next
 * production deploy.
 */

export const POST = createTenantJsonProxy({
  method: "POST",
  onSuccess: answerWithoutEnvelope,
  path: "/auth/passkeys/register/options",
  body: "optional-json",
});
