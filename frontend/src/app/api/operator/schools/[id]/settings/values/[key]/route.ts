import { purgeTenantSettingsCache } from "~/lib/tenant-settings-cache.server";
import { requireStringParam } from "~/lib/route-wrapper-utils.server";
import type { NextRequest } from "next/server";
import { createLogger } from "~/lib/logger";
import {
  createOperatorPutHandler,
  createOperatorDeleteHandler,
} from "~/lib/operator/route-wrapper.server";
import {
  SETTINGS_KEY_SEGMENT,
  TENANT_RESOLVE_AFFECTING_KEYS,
} from "~/lib/settings-keys";
import { bffError } from "~/lib/api-response-error.server";
import { contractGet, contractWrite } from "~/lib/contract/client.server";
import { routes } from "~/lib/contract/operator-schools.generated";
import type * as sharedContract from "~/lib/contract/shared.generated";

const logger = createLogger({
  component: "OperatorSchoolSettingsValuesRoute",
});

async function resolveSchoolSubdomain(
  schoolId: string,
  token: string,
): Promise<string | null> {
  try {
    // No dedicated single-school endpoint exists; the summaries list is the
    // cheapest server-side path that returns the subdomain for an operator. List
    // size is bounded (one entry per school in the platform) so a single
    // server-to-server call per write is acceptable for an admin action.
    // Identifiers arrive as strings (ADR 0300).
    const result = await contractGet(
      routes["GET /operator/schools/summaries"],
      { token },
    );
    if (!result.ok) throw result.error.cause;
    const match = result.value.data.find((school) => school.id === schoolId);
    return match?.subdomain ?? null;
  } catch (error) {
    logger.warn("school_subdomain_lookup_failed", {
      school_id: schoolId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function revalidateTenantIfNeeded(
  schoolId: string,
  key: string,
  token: string,
): Promise<void> {
  if (!TENANT_RESOLVE_AFFECTING_KEYS.has(key)) return;

  const subdomain = await resolveSchoolSubdomain(schoolId, token);
  if (!subdomain) {
    purgeTenantSettingsCache();
    logger.warn("tenant_revalidate_all_no_subdomain", {
      school_id: schoolId,
      key,
    });
    return;
  }

  purgeTenantSettingsCache(subdomain);
  logger.info("tenant_cache_revalidated", { subdomain, key });
}

export const PUT = createOperatorPutHandler(
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
    if (result.backend?.ok) await revalidateTenantIfNeeded(id, key, token);
    if (!result.ok) throw result.error.cause;
    return result.value.data;
  },
);

export const DELETE = createOperatorDeleteHandler(
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
    if (result.backend?.ok) await revalidateTenantIfNeeded(id, key, token);
    if (!result.ok) throw result.error.cause;
    return result.value.data;
  },
);
