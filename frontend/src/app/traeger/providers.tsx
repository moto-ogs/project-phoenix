"use client";

import type { Session } from "next-auth";
import { TraegerAnalyticsSession } from "~/components/analytics/traeger-analytics-session";
import { PortalProviders } from "~/components/auth/portal-providers";
import { ErrorContactProvider } from "~/lib/error-contact";

/** Träger-scoped providers ("moto träger", #4649). */
export function TraegerProviders({
  children,
  session,
}: Readonly<{ children: React.ReactNode; session?: Session | null }>) {
  return (
    <PortalProviders portal="traeger" session={session}>
      <TraegerAnalyticsSession />
      {/* A missing right sends the person to the Leitung of the
          Träger-Büro, not to a school (#6871). */}
      <ErrorContactProvider contact="traeger">{children}</ErrorContactProvider>
    </PortalProviders>
  );
}
