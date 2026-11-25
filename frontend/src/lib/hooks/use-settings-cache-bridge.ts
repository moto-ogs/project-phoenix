"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { subscribeSettingsChanged } from "~/lib/settings-broadcast";
import { useTenantMutate, useTenantMutateMatching } from "~/lib/swr";
import {
  devicePinKeys,
  homeKeys,
  STUDENT_KEY_FAMILIES,
} from "~/lib/swr/portal-keys";
import { shellResourceKeys } from "~/lib/swr/shell-keys";
import { announceChangeRequestsChanged } from "~/lib/change-requests-refresh";

/**
 * Bridges cross-tab/cross-origin settings-change broadcasts to the active
 * tenant's SWR cache entries for the settings schema and device-PIN status.
 * Mount once in the protected layout —
 * every SWR consumer (sidebar, mobile bottom nav, settings page, timetable
 * day hours) then refreshes automatically when:
 *   1. another same-origin tab calls notifySettingsChanged()  → BroadcastChannel
 *   2. backend fires tenant_settings_changed                  → SSE → window event
 *
 * Without this bridge, only the tab that initiated the change saw the new
 * value; other tabs' SWR caches stayed stale until navigation or reload.
 */
export function useSettingsCacheBridge(): void {
  const { data: session } = useSession();
  const tenantMutate = useTenantMutate();
  const refreshActionAccess = useTenantMutateMatching([
    STUDENT_KEY_FAMILIES.detail,
    "timetable-roster-",
    "timetable-day-",
    "timetable-week-",
    "timetable-month-",
    "timetable-detail-",
    "active-supervision-dashboard-",
    homeKeys.dayFlow(),
  ]);
  const accountId = session?.user.id;

  useEffect(() => {
    const invalidate = () => {
      void tenantMutate(shellResourceKeys.settingsSchema());
      void tenantMutate(devicePinKeys.status());
      // The navigation context carries the school switches the app shell
      // reads outside the settings page (#4996).
      void tenantMutate(shellResourceKeys.userContext());
      void refreshActionAccess();
      announceChangeRequestsChanged();
      if (accountId) {
        void tenantMutate(shellResourceKeys.changeRequestAccess(accountId));
      }
    };
    const unsubscribeBroadcast = subscribeSettingsChanged(invalidate);
    if (typeof window !== "undefined") {
      window.addEventListener("phoenix:tenant-settings-stale", invalidate);
    }
    return () => {
      unsubscribeBroadcast();
      if (typeof window !== "undefined") {
        window.removeEventListener("phoenix:tenant-settings-stale", invalidate);
      }
    };
  }, [accountId, tenantMutate, refreshActionAccess]);
}
