import "server-only";
import { revalidateTag, unstable_cache } from "next/cache";
import type { TenantSettings } from "~/lib/tenant-api";

/** The backend's answer to `/auth/tenant/resolve?slug=…` (snake_case). */
export interface TenantResolveResponse {
  tenant_id: number;
  slug: string;
  name: string;
  subdomain: string;
  organization_id: number;
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

const TENANT_CACHE_SECONDS = 60;

interface TenantCacheEntry {
  data: TenantResolveResponse;
  expiresAt: number;
}

async function loadTenant(
  slug: string,
  forwardHeaders: Record<string, string>,
): Promise<TenantCacheEntry> {
  const { getServerApiUrl } = await import("~/lib/server-api-url");
  const res = await fetch(
    `${getServerApiUrl()}/auth/tenant/resolve?slug=${encodeURIComponent(slug)}`,
    { headers: forwardHeaders, cache: "no-store" },
  );
  if (!res.ok) throw new TenantResolveStatusError(res.status);
  const { data } = (await res.json()) as { data: TenantResolveResponse };
  return { data, expiresAt: Date.now() + TENANT_CACHE_SECONDS * 1_000 };
}

const tenantLoads = new Map<string, Promise<TenantCacheEntry>>();

function refreshTenant(
  slug: string,
  forwardHeaders: Record<string, string>,
): Promise<TenantCacheEntry> {
  const active = tenantLoads.get(slug);
  if (active) return active;
  const pending = loadTenant(slug, forwardHeaders).finally(() => {
    if (tenantLoads.get(slug) === pending) tenantLoads.delete(slug);
  });
  tenantLoads.set(slug, pending);
  return pending;
}

export function invalidateTenantResolve(slug: string): void {
  tenantLoads.delete(slug);
  revalidateTag(`tenant-${slug}`, { expire: 0 });
}

/**
 * Each replica caches successful lookups by school slug. The client headers
 * travel in the closure, so a miss uses that visitor's IP without splitting
 * the cache by address. Settings writes invalidate the receiving replica.
 */
export async function resolveTenantCached(
  slug: string,
  forwardHeaders: Record<string, string>,
): Promise<TenantResolveResponse> {
  let pending: Promise<TenantCacheEntry> | undefined;
  const load = async () => (pending ??= refreshTenant(slug, forwardHeaders));
  const entry = await unstable_cache(load, ["tenant-resolve", slug], {
    revalidate: TENANT_CACHE_SECONDS,
    tags: [`tenant-${slug}`],
  })();
  // Next can return the old entry while its refresh runs. After expiry,
  // await that same fetch so even the first request sees current settings.
  return (entry.expiresAt > Date.now() ? entry : await load()).data;
}
