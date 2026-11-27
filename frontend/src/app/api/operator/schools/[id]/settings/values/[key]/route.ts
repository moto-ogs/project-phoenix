import { purgeTenantSettingsCache } from "~/lib/tenant-settings-cache.server";
import { requireStringParam } from "~/lib/route-wrapper-utils.server";
import type { NextRequest } from "next/server";
import { createLogger } from "~/lib/logger";
import { operator } from "~/lib/operator/route-wrapper.server";
import {
  SETTINGS_KEY_SEGMENT,
  TENANT_RESOLVE_AFFECTING_KEYS,
} from "~/lib/settings-keys";
import { bffError } from "~/lib/api-response-error.server";
import { contractWrite } from "~/lib/contract/client.server";
import { routes } from "~/lib/contract/operator-schools.generated";
import type * as sharedContract from "~/lib/contract/shared.generated";

const logger = createLogger({
  component: "OperatorSchoolSettingsValuesRoute",
});

function revalidateTenantIfNeeded(
  schoolId: string,
  key: string,
  subdomain: string | undefined,
): void {
  if (!TENANT_RESOLVE_AFFECTING_KEYS.has(key)) return;

  purgeTenantSettingsCache(subdomain || undefined);
  if (!subdomain) {
    logger.warn("tenant_revalidate_all_no_subdomain", {
      school_id: schoolId,
      key,
    });
    return;
  }

  logger.info("tenant_cache_revalidated", { subdomain, key });
}

export const PUT = operator.put(
  async (
    request: NextRequest,
    body: sharedContract.setSchoolSettingRequest,
    token: string,
    params: Record<string, unknown>,
  ) => {
    const id = requireStringParam(params, "id");
    const key = params.key as string;
    if (!SETTINGS_KEY_SEGMENT.test(key)) {
      throw bffError(400, "Invalid settings key format");
    }
    const result = await contractWrite(
      routes["PUT /operator/schools/{id}/settings/values/{key}"],
      body,
      {
        params: { id, key },
        token,
        request,
      },
    );
    // Go may have applied the change even if the reply cannot be read.
    if (result.backend?.ok) {
      revalidateTenantIfNeeded(
        id,
        key,
        result.ok ? result.value.data.school_slug : undefined,
      );
    }
    if (!result.ok) throw result.error.cause;
    return result.value.data;
  },
);

export const DELETE = operator.del(
  async (
    request: NextRequest,
    token: string,
    params: Record<string, unknown>,
  ) => {
    const id = requireStringParam(params, "id");
    const key = params.key as string;
    if (!SETTINGS_KEY_SEGMENT.test(key)) {
      throw bffError(400, "Invalid settings key format");
    }
    const result = await contractWrite(
      routes["DELETE /operator/schools/{id}/settings/values/{key}"],
      undefined,
      {
        params: { id, key },
        token,
        request,
      },
    );
    if (result.backend?.ok) {
      revalidateTenantIfNeeded(
        id,
        key,
        result.ok ? result.value.data.school_slug : undefined,
      );
    }
    if (!result.ok) throw result.error.cause;
    return result.value.data;
  },
);
