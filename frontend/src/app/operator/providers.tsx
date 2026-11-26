"use client";

import type { Session } from "next-auth";
import { PortalProviders } from "~/components/auth/portal-providers";
import { operatorPath } from "~/lib/operator-url";

/**
 * Operator-scoped providers: the shared portal session frame only. No
 * ProfileProvider or SupervisionProvider — those are tenant-only.
 */
// The login explains that the session ended (read when it does).
const operatorExpiredLogin = () =>
  operatorPath("/operator/login?error=SessionExpired");

export function OperatorProviders({
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
      portal="operator"
      session={session}
      sessionMark={sessionMark}
      endedSessionUrl={operatorExpiredLogin}
    >
      {children}
    </PortalProviders>
  );
}
