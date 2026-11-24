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

function settingsWriteOptions(
  request: NextRequest,
  token: string,
  params: Record<string, unknown>,
) {
  const key = requireStringParam(params, "key");
  if (!SETTINGS_KEY_SEGMENT.test(key)) {
    throw bffError(400, "Invalid settings key format");
  }
  return { params: { key }, token, request };
}

async function invalidateAfterWrite(
  committed: boolean | undefined,
  key: string,
) {
  if (!committed || !TENANT_RESOLVE_AFFECTING_KEYS.has(key)) return;
  const organizationId = (await traegerPortal.auth())?.user?.orgId;
  if (organizationId) purgeOrganizationTenantSettingsCache(organizationId);
}

export const PUT = traeger.put(
  async (request, body: setValueRequest, token, params) => {
    const options = settingsWriteOptions(request, token, params);
    const result = await contractWrite(
      routes["PUT /traeger/settings/values/{key}"],
      body,
      options,
    );
    await invalidateAfterWrite(result.backend?.ok, options.params.key);
    if (!result.ok) throw result.error.cause;
    return result.value.data;
  },
);

export const DELETE = traeger.del(async (request, token, params) => {
  const options = settingsWriteOptions(request, token, params);
  const result = await contractWrite(
    routes["DELETE /traeger/settings/values/{key}"],
    undefined,
    options,
  );
  await invalidateAfterWrite(result.backend?.ok, options.params.key);
  if (!result.ok) throw result.error.cause;
  return result.value.data;
});
