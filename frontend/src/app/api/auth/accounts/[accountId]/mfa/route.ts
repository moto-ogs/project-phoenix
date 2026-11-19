import { answerWithoutEnvelope } from "~/lib/json-proxy.server";
import { createTenantJsonProxy } from "~/lib/route-wrapper.server";

/**
 * Temporary (#2352): the staff portal's catalog proxy answers this path once
 * this file is gone. It stays one release for an installed app with an older
 * bundle, which reads the bare second-factor state; the backend answers in the envelope now,
 * and the current client reads both shapes. Delete it after the next
 * production deploy.
 */

export const GET = createTenantJsonProxy({
  method: "GET",
  onSuccess: answerWithoutEnvelope,
  path: (_request, params) =>
    `/auth/accounts/${encodeURIComponent(String(params.accountId))}/mfa`,
});

export const DELETE = createTenantJsonProxy({
  method: "DELETE",
  path: (_request, params) =>
    `/auth/accounts/${encodeURIComponent(String(params.accountId))}/mfa`,
  body: "optional-json",
});
