"use client";

import type { Session } from "next-auth";
import { PortalAnalyticsSession } from "~/components/analytics/portal-analytics-session";
import { PortalProviders } from "~/components/auth/portal-providers";

/** Caterer-scoped providers (ADR 0077). */
export function CatererProviders({
  children,
  session,
  sessionMark,
}: Readonly<{
  children: React.ReactNode;
  session?: Session | null;
  /** The session mark the page was rendered with (#8082). */
  sessionMark: string;
}>) {
  return (
    <PortalProviders
      portal="caterer"
      session={session}
      sessionMark={sessionMark}
    >
      <PortalAnalyticsSession surface="caterer" />
      {children}
    </PortalProviders>
  );
}
