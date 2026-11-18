"use client";

import type { Session } from "next-auth";
import { PortalAnalyticsSession } from "~/components/analytics/portal-analytics-session";
import { SCHOOL_ANALYTICS_CONSENT_COPY } from "~/components/analytics/analytics-consent-copy";
import { PortalProviders } from "~/components/auth/portal-providers";
import { PushSubscriptionSync } from "~/components/notifications/push-subscription-sync";
import { ModulePortalProvider } from "~/lib/module-portal-context";

/**
 * School-scoped providers ("moto schule", #2207).
 *
 * No TenantProvider — the school portal has exactly one surface (the
 * Klassenansicht) and its tenant binding lives in the JWT, not in the URL.
 */
export function SchoolProviders({
  children,
  session,
}: Readonly<{ children: React.ReactNode; session?: Session | null }>) {
  return (
    <PortalProviders portal="school" session={session}>
      {/* Rebinds an existing browser push subscription to the current school
          session (#2208) — the tenant and parents portals do the same. */}
      <PushSubscriptionSync portal="school" />
      <PortalAnalyticsSession
        surface="school"
        consentCopy={SCHOOL_ANALYTICS_CONSENT_COPY}
      />
      <ModulePortalProvider portal="school">{children}</ModulePortalProvider>
    </PortalProviders>
  );
}
