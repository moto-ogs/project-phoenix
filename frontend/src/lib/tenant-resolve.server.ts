import "server-only";
import { revalidateTag } from "next/cache";
import { sendBackend } from "~/lib/backend-client.server";
import type { TenantSettings } from "~/lib/tenant-api";
import type * as authTenantContract from "~/lib/contract/auth-tenant.generated";

/**
 * The backend's answer to `/auth/tenant/resolve?slug=…`. The contract
 * carries `settings` as an untyped object; the layout reads it as the
 * tenant settings.
 */
export type TenantResolveResponse = Omit<
  authTenantContract.TenantResolveResponse,
  "settings"
> & { settings: TenantSettings | null };

/** A non-200 answer of the tenant lookup; never cached. */
export class TenantResolveStatusError extends Error {
  constructor(readonly status: number) {
    super(`Tenant resolution failed with HTTP ${status}`);
  }
}

const TENANT_CACHE_TTL_MS = 60_000;
const TENANT_CACHE_LIMIT = 1_000;
const CACHE = Symbol.for("moto.tenant-resolve-cache");

type TenantLookup =
  { ok: true; data: TenantResolveResponse } | { ok: false; status: number };

interface TenantCacheEntry {
  lookup: Promise<TenantLookup>;
  expiresAt: number;
}

// The layout and the settings routes may carry separate copies of this module.
function tenantCache(): Map<string, TenantCacheEntry> {
  const state = globalThis as typeof globalThis & {
    [CACHE]?: Map<string, TenantCacheEntry>;
  };
  return (state[CACHE] ??= new Map());
}

async function loadTenant(
  slug: string,
  forwardHeaders: Record<string, string>,
): Promise<TenantLookup> {
  // The visitor who starts the lookup supplies the forwarding headers.
  const res = await sendBackend(
    `/auth/tenant/resolve?slug=${encodeURIComponent(slug)}`,
    null,
    { headers: forwardHeaders },
  );
  if (!res.ok) return { ok: false, status: res.status };
  const { data } = (await res.json()) as { data: TenantResolveResponse };
  return { ok: true, data };
}

export function invalidateTenantResolve(slug: string): void {
  tenantCache().delete(slug);
  revalidateTag(`tenant-${slug}`, { expire: 0 });
}

/**
 * Each replica caches successful lookups by school slug. The visitor who
 * starts the lookup supplies the forwarding headers. Other visitors reuse it.
 */
export async function resolveTenantCached(
  slug: string,
  forwardHeaders: Record<string, string>,
): Promise<TenantResolveResponse> {
  const result = await lookupTenant(slug, forwardHeaders);
  // Route bundles have separate error classes even though they share data.
  if (!result.ok) throw new TenantResolveStatusError(result.status);
  return result.data;
}

function lookupTenant(
  slug: string,
  forwardHeaders: Record<string, string>,
): Promise<TenantLookup> {
  const cache = tenantCache();
  const now = Date.now();
  const cached = cache.get(slug);
  if (cached && cached.expiresAt > now) return cached.lookup;

  const entry: TenantCacheEntry = {
    expiresAt: Infinity,
    lookup: loadTenant(slug, forwardHeaders).then(
      (result) => {
        if (result.ok) {
          // Updating the entry in place cannot restore it after invalidation.
          entry.expiresAt = now + TENANT_CACHE_TTL_MS;
        } else if (cache.get(slug) === entry) {
          cache.delete(slug);
        }
        return result;
      },
      (error: unknown) => {
        if (cache.get(slug) === entry) cache.delete(slug);
        throw error;
      },
    ),
  };

  cache.delete(slug);
  if (cache.size >= TENANT_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(slug, entry);
  return entry.lookup;
}
