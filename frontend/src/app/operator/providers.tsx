"use client";

import type { Session } from "next-auth";
import { PortalProviders } from "~/components/auth/portal-providers";

/**
 * Operator-scoped providers: the shared portal session frame only. No
 * ProfileProvider or SupervisionProvider — those are tenant-only.
 */
export function OperatorProviders({
  children,
  session,
}: Readonly<{ children: React.ReactNode; session?: Session | null }>) {
  return (
    <PortalProviders portal="operator" session={session}>
      {children}
    </PortalProviders>
  );
}
