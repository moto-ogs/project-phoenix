"use client";

import type { Session } from "next-auth";
import { PortalAnalyticsSession } from "~/components/analytics/portal-analytics-session";
import { PortalProviders } from "~/components/auth/portal-providers";

/** Caterer-scoped providers (ADR 0077). */
export function CatererProviders({
  children,
  session,
}: Readonly<{ children: React.ReactNode; session?: Session | null }>) {
  return (
    <PortalProviders portal="caterer" session={session}>
      <PortalAnalyticsSession surface="caterer" />
      {children}
    </PortalProviders>
  );
}
