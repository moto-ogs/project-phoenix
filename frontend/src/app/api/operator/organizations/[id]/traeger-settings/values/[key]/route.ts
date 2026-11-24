import type { NextRequest } from "next/server";
import { bffError } from "~/lib/api-response-error.server";
import { contractWrite } from "~/lib/contract/client.server";
import { routes } from "~/lib/contract/operator-organizations.generated";
import type { setSchoolSettingRequest } from "~/lib/contract/shared.generated";
import {
  createOperatorDeleteHandler,
  createOperatorPutHandler,
} from "~/lib/operator/route-wrapper.server";
import { requireStringParam } from "~/lib/route-wrapper-utils.server";
import {
  SETTINGS_KEY_SEGMENT,
  TENANT_RESOLVE_AFFECTING_KEYS,
} from "~/lib/settings-keys";
import { purgeOrganizationTenantSettingsCache } from "~/lib/tenant-settings-cache.server";

function settingsWriteOptions(
  request: NextRequest,
  token: string,
  params: Record<string, unknown>,
) {
  const id = requireStringParam(params, "id");
  const key = requireStringParam(params, "key");
  if (!SETTINGS_KEY_SEGMENT.test(key)) {
    throw bffError(400, "Invalid settings key format");
  }
  return { params: { id, key }, token, request };
}

function invalidateAfterWrite(
  committed: boolean | undefined,
  { id, key }: { id: string; key: string },
) {
  if (!committed || !TENANT_RESOLVE_AFFECTING_KEYS.has(key)) return;
  purgeOrganizationTenantSettingsCache(id);
}

export const PUT = createOperatorPutHandler(
  async (request, body: setSchoolSettingRequest, token, params) => {
    const options = settingsWriteOptions(request, token, params);
    const result = await contractWrite(
      routes["PUT /operator/organizations/{id}/traeger-settings/values/{key}"],
      body,
      options,
    );
    invalidateAfterWrite(result.backend?.ok, options.params);
    if (!result.ok) throw result.error.cause;
    return result.value.data;
  },
);

export const DELETE = createOperatorDeleteHandler(
  async (request, token, params) => {
    const options = settingsWriteOptions(request, token, params);
    const result = await contractWrite(
      routes[
        "DELETE /operator/organizations/{id}/traeger-settings/values/{key}"
      ],
      undefined,
      options,
    );
    invalidateAfterWrite(result.backend?.ok, options.params);
    if (!result.ok) throw result.error.cause;
    return result.value.data;
  },
);
