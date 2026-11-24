import type { NextRequest } from "next/server";
import { bffError } from "~/lib/api-response-error.server";
import { contractWrite } from "~/lib/contract/client.server";
import { routes } from "~/lib/contract/traeger-settings.generated";
import type { setValueRequest } from "~/lib/contract/shared.generated";
import { requireStringParam } from "~/lib/route-wrapper-utils.server";
import {
  SETTINGS_KEY_SEGMENT,
  TENANT_RESOLVE_AFFECTING_KEYS,
} from "~/lib/settings-keys";
import { purgeOrganizationTenantSettingsCache } from "~/lib/tenant-settings-cache.server";
import { traeger } from "~/lib/traeger/route-wrapper.server";
import { traegerPortal } from "~/server/auth/traeger";

async function write(
  request: NextRequest,
  token: string,
  params: Record<string, unknown>,
  body?: setValueRequest,
) {
  const key = requireStringParam(params, "key");
  if (!SETTINGS_KEY_SEGMENT.test(key)) {
    throw bffError(400, "Invalid settings key format");
  }
  const options = { params: { key }, token, request };
  const result =
    body === undefined
      ? await contractWrite(
          routes["DELETE /traeger/settings/values/{key}"],
          undefined,
          options,
        )
      : await contractWrite(
          routes["PUT /traeger/settings/values/{key}"],
          body,
          options,
        );
  if (result.backend?.ok && TENANT_RESOLVE_AFFECTING_KEYS.has(key)) {
    const organizationId = (await traegerPortal.auth())?.user?.orgId;
    if (organizationId) purgeOrganizationTenantSettingsCache(organizationId);
  }
  if (!result.ok) throw result.error.cause;
  return result.value.data;
}

export const PUT = traeger.put(
  (request, body: setValueRequest, token, params) =>
    write(request, token, params, body),
);
export const DELETE = traeger.del((request, token, params) =>
  write(request, token, params),
);
