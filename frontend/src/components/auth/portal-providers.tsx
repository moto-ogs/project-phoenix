"use client";

import type { Session } from "next-auth";
import { SessionProvider } from "next-auth/react";
import { PersonalStorageGuard } from "~/components/auth/personal-storage-guard";
import { PORTAL_FRAME } from "~/components/auth/portal-frame";
import { SentrySessionContext } from "~/components/auth/sentry-session-context";
import {
  SessionAccountBinding,
  useSessionPollInterval,
} from "~/components/auth/session-account-binding";
import { SessionEndBarrier } from "~/components/auth/session-end-barrier";
import { PORTAL_ROUTES, type HostedPortalKey } from "~/lib/portal-paths";
import { SESSION_PROVIDER_POLL_SECONDS } from "~/lib/session-provider-poll";
import { SWRScopeBoundary } from "~/lib/swr/scope-boundary";

/**
 * The session frame of a portal on its own host. SessionProvider reads the
 * portal's host-only cookie through the portal's BFF base path, so no other
 * portal's session is visible here. `children` carries the portal's own
 * providers and session components.
 *
 * `session` is the layout's read-only cookie snapshot (#4990, #4991).
 * Without one the provider receives undefined and fetches the session;
 * null would mean "signed out" and skip that fetch.
 */
export function PortalProviders({
  portal,
  session,
  children,
}: Readonly<{
  portal: HostedPortalKey;
  session?: Session | null;
  children: React.ReactNode;
}>) {
  const pollSeconds = useSessionPollInterval(SESSION_PROVIDER_POLL_SECONDS);
  return (
    <SessionProvider
      basePath={PORTAL_ROUTES[portal].basePath}
      session={session ?? undefined}
      refetchInterval={pollSeconds}
      refetchOnWindowFocus={false}
    >
      <SessionAccountBinding />
      <SessionEndBarrier />
      <PersonalStorageGuard homeHref={PORTAL_FRAME[portal].homeHref} />
      <SWRScopeBoundary />
      <SentrySessionContext portal={portal} />
      {children}
    </SessionProvider>
  );
}
