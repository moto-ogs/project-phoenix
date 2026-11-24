import { expect, it } from "vitest";
import type { TenantResolveResponse } from "./auth-tenant.generated";
import { browserRoutePaths } from "./browser-traits.generated";
import {
  tenantLookupWrites,
  tenantHostLookupWrites,
} from "./tenant-lookup-writes.server";

const createSchool = "POST /operator/schools/";
const editSchool = "PUT /operator/schools/{id}";
const editOrganization = "PUT /operator/organizations/{id}";
const schoolSettings = "PUT /api/settings/values/{key}";
const loginImage = "POST /api/settings/login-image";

const writesByField = {
  tenant_id: [createSchool],
  slug: [editSchool],
  name: [editSchool],
  subdomain: [editSchool],
  organization_id: [editSchool],
  organization_name: [editOrganization],
  traeger_name: [createSchool, editSchool, editOrganization],
  hidden: [editSchool],
  settings: [loginImage],
  presence_mode: [schoolSettings],
  student_photos_enabled: [schoolSettings],
  booked_modules: [schoolSettings],
  parent_messaging_enabled: [schoolSettings],
  parent_message_card_badge_enabled: [schoolSettings],
  staff_messaging_enabled: [schoolSettings],
  display_enabled: [schoolSettings],
  caldav_enabled: [schoolSettings],
  grade_level_max: [schoolSettings],
  care_offerings_enabled: [schoolSettings],
  attendance_web_enabled: [schoolSettings],
  attendance_log_enabled: [schoolSettings],
  group_mode: [schoolSettings],
  operational_overview_scope: [schoolSettings],
  attendance_edit_scope: [schoolSettings],
  parent_request_reason_policy: [schoolSettings],
  show_timetable_counts: [schoolSettings],
  timetable_enabled: [schoolSettings],
  meal_plan_enabled: [schoolSettings],
  meal_registration_enabled: [schoolSettings],
  waitlist_enabled: [schoolSettings],
  analytics_enabled: [schoolSettings],
  analytics_freigabe: [schoolSettings],
  analytics_recording_sample_percent: [schoolSettings],
  early_checkout_note_enabled: [schoolSettings],
  early_checkout_note_tolerance_minutes: [schoolSettings],
  weekend_follows_friday: [schoolSettings],
  children_without_care_place: [schoolSettings],
  child_search_only_navigation: [schoolSettings],
  simple_staff_navigation: [schoolSettings],
  care_facility_term: [schoolSettings],
} satisfies Record<keyof Required<TenantResolveResponse>, readonly string[]>;

it("binds every lookup field to an invalidating write", () => {
  const namedWrites = [schoolSettings];
  for (const route of namedWrites) {
    expect(browserRoutePaths.tenant).toHaveProperty(route);
  }
  for (const [field, routes] of Object.entries(writesByField)) {
    expect(routes.length, field).toBeGreaterThan(0);
    for (const route of routes) {
      expect(
        tenantLookupWrites.has(route) ||
          tenantHostLookupWrites.has(route) ||
          namedWrites.includes(route),
        `${field}: ${route}`,
      ).toBe(true);
    }
  }
});
