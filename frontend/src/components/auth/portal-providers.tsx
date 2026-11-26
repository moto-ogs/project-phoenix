"use client";

import type { Session } from "next-auth";
import { useMemo } from "react";
import { SessionProvider } from "next-auth/react";
import { PersonalStorageGuard } from "~/components/auth/personal-storage-guard";
import { PORTAL_FRAME } from "~/components/auth/portal-frame";
import { SentrySessionContext } from "~/components/auth/sentry-session-context";
import {
  SessionAccountBinding,
  useSessionPollInterval,
} from "~/components/auth/session-account-binding";
import { SessionEndBarrier } from "~/components/auth/session-end-barrier";
import {
  SessionTreeBoundary,
  StaleSessionMarkCheck,
  type SessionTreeLabels,
} from "~/components/auth/session-tree-boundary";
import { PORTAL_ROUTES, type HostedPortalKey } from "~/lib/portal-paths";
import { SESSION_PROVIDER_POLL_SECONDS } from "~/lib/session-provider-poll";
import { SWRScopeBoundary } from "~/lib/swr/scope-boundary";
import { sessionMarkName } from "~/lib/session-mark";
import { clientEnv } from "~/env.client";

/**
 * The session frame of a portal on its own host. SessionProvider reads the
 * portal's host-only cookie through the portal's BFF base path, so no other
 * portal's session is visible here. `children` carries the portal's own
 * providers and pages; they render under the portal's session boundary
 * (#8082). The session components before it draw nothing.
 *
 * `session` is the layout's read-only cookie snapshot (#4990, #4991).
 * Without one the provider receives undefined and fetches the session;
 * null would mean "signed out" and skip that fetch.
 */
export function PortalProviders({
  portal,
  session,
  sessionMark,
  sessionTreeLabels,
  endedSessionUrl,
  children,
}: Readonly<{
  portal: HostedPortalKey;
  session?: Session | null;
  /** The session mark the page was rendered with (#8082). */
  sessionMark: string;
  /** Texts of the session boundary in the portal's language. */
  sessionTreeLabels?: SessionTreeLabels;
  /** Where a session the server ended leads (the login with its notice). */
  endedSessionUrl?: () => string;
  children: React.ReactNode;
}>) {
  const pollSeconds = useSessionPollInterval(SESSION_PROVIDER_POLL_SECONDS);
  const mark = useMemo(
    () => ({
      name: sessionMarkName(portal, clientEnv.NEXT_PUBLIC_TENANT_DOMAIN),
      rendered: sessionMark,
    }),
    [portal, sessionMark],
  );
  return (
    <SessionProvider
      basePath={PORTAL_ROUTES[portal].basePath}
      session={session ?? undefined}
      refetchInterval={pollSeconds}
      refetchOnWindowFocus={false}
    >
      <StaleSessionMarkCheck sessionMark={mark} />
      <SessionAccountBinding />
      <SessionEndBarrier />
      <PersonalStorageGuard homeHref={PORTAL_FRAME[portal].homeHref} />
      <SWRScopeBoundary />
      <SentrySessionContext portal={portal} />
      <SessionTreeBoundary
        portal={portal}
        sessionMark={mark}
        labels={sessionTreeLabels}
        endedSessionUrl={endedSessionUrl}
      >
        {children}
      </SessionTreeBoundary>
    </SessionProvider>
  );
}
