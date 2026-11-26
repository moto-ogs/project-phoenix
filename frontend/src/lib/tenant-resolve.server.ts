import "server-only";
import { contractGet } from "~/lib/contract/client.server";
import {
  parseTenantSettings,
  type TenantSettings,
} from "~/lib/tenant-branding";
import * as authTenantContract from "~/lib/contract/auth-tenant.generated";

/**
 * The backend's answer to `/auth/tenant/resolve?slug=…`. The contract
 * carries open settings; the cache validates the known branding fields.
 */
export type TenantResolveResponse = Omit<
  authTenantContract.TenantResolveResponse,
  "settings"
> & { settings: TenantSettings | null };

/** A non-200 answer of the tenant lookup. Only 404 is cached. */
export class TenantResolveStatusError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfter: string | null = null,
  ) {
    super(`Tenant resolution failed with HTTP ${status}`);
  }
}

const TENANT_CACHE_TTL_MS = 60_000;
const TENANT_CACHE_LIMIT = 1_000;
const CACHE = Symbol.for("moto.tenant-lookup-cache.v2");

type TenantLookup =
  | { ok: true; data: TenantResolveResponse }
  | { ok: false; status: number; retryAfter: string | null };

interface TenantCacheEntry {
  lookup: Promise<TenantLookup>;
  expiresAt: number;
}

interface TenantCache {
  hits: Map<string, TenantCacheEntry>;
  misses: Map<string, TenantCacheEntry>;
  pending: Map<string, TenantCacheEntry>;
}

// The layout and the settings routes may carry separate copies of this module.
function tenantCache(): TenantCache {
  const state = globalThis as typeof globalThis & {
    [CACHE]?: TenantCache;
  };
  return (state[CACHE] ??= {
    hits: new Map(),
    misses: new Map(),
    pending: new Map(),
  });
}

async function loadTenant(
  slug: string,
  forwardHeaders: Record<string, string>,
): Promise<TenantLookup> {
  // The visitor who starts the lookup supplies the forwarding headers.
  const route = authTenantContract.routes["GET /auth/tenant/resolve"];
  const result = await contractGet(route, {
    query: { slug },
    headers: forwardHeaders,
  });
  if (!result.ok) {
    return {
      ok: false,
      status: result.error.status,
      retryAfter: result.error.cause.retryAfter,
    };
  }
  const { settings, ...tenant } = result.value.data;
  return {
    ok: true,
    data: { ...tenant, settings: parseTenantSettings(settings) },
  };
}

export function invalidateTenantResolve(slug: string): void {
  const { hits, misses, pending } = tenantCache();
  hits.delete(slug);
  misses.delete(slug);
  pending.delete(slug);
}

export function invalidateAllTenantResolves(): void {
  const { hits, misses, pending } = tenantCache();
  hits.clear();
  misses.clear();
  pending.clear();
}

/**
 * Each replica caches successful and missing lookups by school slug. The visitor who
 * starts the lookup supplies the forwarding headers. Other visitors reuse it.
 */
export async function resolveTenantCached(
  slug: string,
  forwardHeaders: Record<string, string>,
): Promise<TenantResolveResponse> {
  const result = await lookupTenant(slug, forwardHeaders);
  // Route bundles have separate error classes even though they share data.
  if (!result.ok)
    throw new TenantResolveStatusError(result.status, result.retryAfter);
  return result.data;
}

function lookupTenant(
  slug: string,
  forwardHeaders: Record<string, string>,
): Promise<TenantLookup> {
  const { hits, misses, pending } = tenantCache();
  const now = Date.now();
  const inFlight = pending.get(slug);
  if (inFlight) return inFlight.lookup;
  const cached = hits.get(slug) ?? misses.get(slug);
  if (cached && cached.expiresAt > now) return cached.lookup;
  hits.delete(slug);
  misses.delete(slug);

  const entry: TenantCacheEntry = {
    expiresAt: now + TENANT_CACHE_TTL_MS,
    lookup: loadTenant(slug, forwardHeaders).then(
      (result) => {
        if (pending.get(slug) !== entry) return result;
        pending.delete(slug);
        if (result.ok) {
          rememberTenant(hits, slug, entry);
        } else if (result.status === 404) {
          rememberTenant(misses, slug, entry);
        }
        return result;
      },
      (error: unknown) => {
        if (pending.get(slug) === entry) pending.delete(slug);
        throw error;
      },
    ),
  };

  rememberTenant(pending, slug, entry);
  return entry.lookup;
}

// Scanner misses must not evict cached schools.
function rememberTenant(
  cache: Map<string, TenantCacheEntry>,
  slug: string,
  entry: TenantCacheEntry,
): void {
  cache.delete(slug);
  if (cache.size >= TENANT_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(slug, entry);
}
