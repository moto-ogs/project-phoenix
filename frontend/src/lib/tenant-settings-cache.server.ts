import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";
import { getOriginalRequestHost } from "./client-headers.server";
import { createLogger } from "./logger";
import { tenantSlugFromHost } from "./tenant-host";
import { invalidateTenantResolve } from "./tenant-resolve.server";

const logger = createLogger({ component: "TenantSettingsCache" });

export function purgeTenantSettingsCache(slug: string): void {
  invalidateTenantResolve(slug);
  revalidatePath(`/${slug}`, "layout");
}

/** Use the school bound to the request host, not a Referer-supplied path. */
export function purgeRequestTenantSettingsCache(request: NextRequest): void {
  const host = getOriginalRequestHost(request);
  const slug = tenantSlugFromHost(host);
  if (slug) purgeTenantSettingsCache(slug);
  else logger.warn("tenant_revalidate_skipped_no_slug", { host });
}
