import { purgeRequestTenantSettingsCache } from "~/lib/tenant-settings-cache.server";
import type { NextRequest } from "next/server";
import { contractWrite } from "~/lib/contract/client.server";
import { routes } from "~/lib/contract/settings.generated";
import type { setValueRequest } from "~/lib/contract/shared.generated";
import {
  createPutHandler,
  createDeleteHandler,
} from "~/lib/route-wrapper.server";
import {
  SETTINGS_KEY_SEGMENT,
  TENANT_RESOLVE_AFFECTING_KEYS,
} from "~/lib/settings-keys";
import { bffError } from "~/lib/api-response-error.server";

function revalidateTenantIfNeeded(request: NextRequest, key: string): void {
  if (TENANT_RESOLVE_AFFECTING_KEYS.has(key))
    purgeRequestTenantSettingsCache(request);
}

export const PUT = createPutHandler(
  async (
    request: NextRequest,
    body: setValueRequest,
    token: string,
    params: Record<string, unknown>,
  ) => {
    const key = params.key as string;
    if (!SETTINGS_KEY_SEGMENT.test(key)) {
      throw bffError(400, "Invalid settings key format");
    }
    const result = await contractWrite(
      routes["PUT /api/settings/values/{key}"],
      body,
      {
        params: { key },
        token,
        request,
      },
    );
    // Go may have applied the change even if the reply cannot be read.
    if (result.backend?.ok) revalidateTenantIfNeeded(request, key);
    if (!result.ok) throw result.error.cause;
    return result.value.data;
  },
);

export const DELETE = createDeleteHandler(
  async (
    request: NextRequest,
    token: string,
    params: Record<string, unknown>,
  ) => {
    const key = params.key as string;
    if (!SETTINGS_KEY_SEGMENT.test(key)) {
      throw bffError(400, "Invalid settings key format");
    }
    const result = await contractWrite(
      routes["DELETE /api/settings/values/{key}"],
      undefined,
      {
        params: { key },
        token,
        request,
      },
    );
    if (result.backend?.ok) revalidateTenantIfNeeded(request, key);
    if (!result.ok) throw result.error.cause;
    return result.value.data;
  },
);
