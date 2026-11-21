import "server-only";
import { revalidateTag } from "next/cache";
import { sendBackend } from "~/lib/backend-client.server";
import type { TenantSettings } from "~/lib/tenant-api";

/** The backend's answer to `/auth/tenant/resolve?slug=…` (snake_case). */
export interface TenantResolveResponse {
  tenant_id: string;
  slug: string;
  name: string;
  subdomain: string;
  organization_id: string;
  organization_name: string;
  traeger_name?: string;
  hidden?: boolean;
  settings: TenantSettings;
  presence_mode?: string;
  student_photos_enabled?: boolean;
  booked_modules?: string[];
  parent_messaging_enabled?: boolean;
  parent_message_card_badge_enabled?: boolean;
  staff_messaging_enabled?: boolean;
  display_enabled?: boolean;
  caldav_enabled?: boolean;
  care_offerings_enabled?: boolean;
  attendance_web_enabled?: boolean;
  attendance_log_enabled?: boolean;
  group_mode?: string;
  operational_overview_scope?: string;
  attendance_edit_scope?: string;
  parent_request_reason_policy?: string;
  timetable_enabled?: boolean;
  show_timetable_counts?: boolean;
  meal_plan_enabled?: boolean;
  meal_registration_enabled?: boolean;
  waitlist_enabled?: boolean;
  grade_level_max: number;
  analytics_enabled?: boolean;
  analytics_freigabe?: boolean;
  analytics_recording_sample_percent?: number;
  early_checkout_note_enabled?: boolean;
  early_checkout_note_tolerance_minutes?: number;
  weekend_follows_friday?: boolean;
  children_without_care_place?: boolean;
  child_search_only_navigation?: boolean;
  simple_staff_navigation?: boolean;
  care_facility_term?: string;
}

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
