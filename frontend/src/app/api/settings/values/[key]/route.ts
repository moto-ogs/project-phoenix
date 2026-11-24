import { invalidateTenantResolve } from "~/lib/tenant-resolve.server";
import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";
import { contractWrite } from "~/lib/contract/client.server";
import { routes } from "~/lib/contract/settings.generated";
import type { setValueRequest } from "~/lib/contract/shared.generated";
import { createLogger } from "~/lib/logger";
import {
  createPutHandler,
  createDeleteHandler,
} from "~/lib/route-wrapper.server";
import {
  SETTINGS_KEY_SEGMENT,
  TENANT_RESOLVE_AFFECTING_KEYS,
} from "~/lib/settings-keys";
import { tenantSlugFromHost } from "~/lib/tenant-host";
import { bffError } from "~/lib/api-response-error.server";

const logger = createLogger({ component: "SettingsValuesRoute" });

// Settings whose value rides on /auth/tenant/resolve are tagged with
// `tenant-${slug}` in the cached tenant lookup. A naked
// router.refresh() on the client would still see the cached value until
// the TTL expires, so we purge the tag here before responding.
function revalidateTenantIfNeeded(request: NextRequest, key: string): void {
  if (!TENANT_RESOLVE_AFFECTING_KEYS.has(key)) return;

  const slug = tenantSlugFromHost(request.headers.get("host"));
  if (!slug) {
    logger.warn("tenant_revalidate_skipped_no_slug", {
      key,
      host: request.headers.get("host") ?? "",
    });
    return;
  }

  invalidateTenantResolve(slug);
  revalidatePath(`/${slug}`, "layout");
  logger.info("tenant_cache_revalidated", { slug, key });
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
