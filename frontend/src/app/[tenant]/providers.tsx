"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import type { Session } from "next-auth";
import { SessionProvider, useSession } from "next-auth/react";
import { ProfileProvider } from "~/lib/profile-context";
import { supervisionContextKeys } from "~/lib/swr/supervision-keys";
import { SupervisionProvider } from "~/lib/supervision-context";
import { PersonalStorageGuard } from "~/components/auth/personal-storage-guard";
import {
  SessionAccountBinding,
  useSessionPollInterval,
} from "~/components/auth/session-account-binding";
import { SentrySessionContext } from "~/components/auth/sentry-session-context";
import {
  SessionTreeBoundary,
  StaleSessionMarkCheck,
} from "~/components/auth/session-tree-boundary";
import { ModuleBookingAudienceProvider } from "~/contexts/ToastContext";
import { TenantAuthWrapper } from "~/components/auth/tenant-auth-wrapper";
import { PushSubscriptionSync } from "~/components/notifications/push-subscription-sync";
import { announcementKeys, shellResourceKeys } from "~/lib/swr/shell-keys";
import { USER_CONTEXT_SWR_KEY } from "~/lib/hooks/use-user-context";
import { REMINDERS_SWR_KEY } from "~/lib/reminders-api";
import { primeSessionCache } from "~/lib/session-cache";
import { SESSION_PROVIDER_POLL_SECONDS } from "~/lib/session-provider-poll";
import {
  ShellSeedProvider,
  type ShellBootstrap,
  type ShellCounts,
} from "~/lib/shell-seed";
import {
  authGeneration,
  scopedSWRKey,
  stampSWRSeeds,
  SWRScopeBoundary,
  SWRSeedBoundary,
  tenantSWRScope,
  useSWRSessionRefresh,
  writeSWRSeeds,
} from "~/lib/swr";
import { staffNoticesTodayKey } from "~/lib/staff-notices-api";
import { TenantProvider, type TenantRoutingMode } from "~/lib/tenant-context";
import { tenantAwarePath } from "~/lib/tenant-path";
import type { TenantInfo } from "~/lib/tenant-api";
import { seesLockedModules } from "~/lib/module-register";
import { sessionMarkName } from "~/lib/session-mark";
import { clientEnv } from "~/env.client";

/**
 * Mirrors SessionProvider's response into the getSession() dedupe cache that
 * every API client reads (#2973). A layout effect in a leaf rendered BEFORE
 * the provider tree commits before any SWR hook further down starts its mount
 * revalidation; the hydrated session is therefore reused instead of fetched.
 * Later session changes (poll, update()) prime it again; between them the
 * entry holds, except where a flow that rotates tokens calls
 * clearSessionCache() or the BFF refuses another school's session (#5130).
 * An answer without access (logout here or in another tab) drops the entry.
 */
export function SessionCachePrimer() {
  const { data: session } = useSession();
  useLayoutEffect(() => {
    // undefined: the provider has no answer yet. null or an answer without
    // access: the sign-in is gone, and primeSessionCache drops the entry.
    if (session !== undefined) primeSessionCache(session);
  }, [session]);
  return null;
}

function ModuleBookingAudienceBridge({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { data: session } = useSession();
  return (
    <ModuleBookingAudienceProvider
      seesLockedModules={seesLockedModules(session)}
    >
      {children}
    </ModuleBookingAudienceProvider>
  );
}

// The badge each server count seeds (useUnreadCount readers).
const COUNT_KEYS: Record<keyof ShellCounts, (accountId: string) => string> = {
  staffAbsencesPending: shellResourceKeys.staffAbsencesPending,
  messagesUnread: shellResourceKeys.messagesUnread,
  teamChatUnread: shellResourceKeys.teamChatUnread,
  changeRequestsPending: shellResourceKeys.changeRequestsPending,
  enrollmentRequestsPending: shellResourceKeys.enrollmentRequestsPending,
  careWithdrawalsPending: shellResourceKeys.careWithdrawalsPending,
};

/**
 * Shell entries whose readers never revalidate on mount (#4989): the header
 * bell polls the reminders, the sidebar badge reloads today's staff notices
 * on focus and after an acknowledgement, and the home block only shows them.
 * The badge counts reload on their refresh events and on focus. The user
 * context is immutable SWR; settings changes and the
 * guardian-approval retry invalidate it.
 */
export function shellOwnedEntries(shell: ShellBootstrap, tenantSlug: string) {
  // The scope useSWRAuth gives the account the snapshot was built for
  // (#5006): no other account's reader finds these entries.
  const scope = tenantSWRScope(tenantSlug, shell.accountId);
  const entries: Record<string, unknown> = {};
  if (shell.userContext) {
    entries[scopedSWRKey(scope, USER_CONTEXT_SWR_KEY)] = shell.userContext;
  }
  if (shell.supervision) {
    entries[scopedSWRKey(scope, supervisionContextKeys.snapshot())] =
      shell.supervision;
  }
  if (shell.reminders) {
    entries[scopedSWRKey(scope, REMINDERS_SWR_KEY)] = shell.reminders;
  }
  if (shell.announcements) {
    entries[scopedSWRKey(scope, announcementKeys.unread())] =
      shell.announcements;
  }
  if (shell.staffNoticesToday) {
    entries[scopedSWRKey(scope, staffNoticesTodayKey(shell.accountId))] =
      shell.staffNoticesToday;
  }
  for (const [name, key] of Object.entries(COUNT_KEYS)) {
    const count = shell.counts[name as keyof ShellCounts];
    if (count !== undefined) {
      entries[scopedSWRKey(scope, key(shell.accountId))] = count;
    }
  }
  return entries;
}

const NO_ENTRIES: Record<string, unknown> = {};
const NO_SEED = { fallback: NO_ENTRIES, cacheData: NO_ENTRIES };

/** Fallback for server render/hydration; ShellCacheSeeder owns the cache write. */
export function shellSwrConfig(shell: ShellBootstrap, tenantSlug: string) {
  return {
    fallback: shellOwnedEntries(shell, tenantSlug),
    cacheData: NO_ENTRIES,
  };
}

/**
 * Writes the shell-owned entries into the SWR cache. A reader with
 * `revalidateIfStale: false` shows `fallback` and skips the mount
 * revalidation, so SWR never turns `cacheData` into a cache entry, and the
 * first later revalidation (poll, mutate, focus) answered with the seed
 * instead of asking the server (#4989). Like SessionCachePrimer, a leaf
 * rendered before the provider tree: its layout effect runs before any
 * reader mounts. An entry a reader already holds stays.
 */
export function ShellCacheSeeder({
  entries,
}: Readonly<{ entries: Record<string, unknown> }>) {
  useLayoutEffect(() => {
    writeSWRSeeds(entries);
  }, [entries]);
  return null;
}

/**
 * The server preload, only while the session is the one it was built for
 * (#5006). After a change of rights or preview, even under the same keys, no
 * reader may receive the snapshot of the session before; the cache reset of
 * SWRScopeBoundary drops what the seeder wrote, this drops the fallback. A
 * generation once left never takes the seed back.
 */
function ShellSwrSeed({
  seed,
  generation,
  children,
}: Readonly<{
  seed: ReturnType<typeof shellSwrConfig>;
  generation: string | null;
  children: React.ReactNode;
}>) {
  const { data: session, status } = useSession();
  const current = status === "loading" ? generation : authGeneration(session);
  const refresh = useSWRSessionRefresh();
  const initialRevision = useRef(refresh.revision);
  const left = useRef(false);
  const invalidated =
    refresh.pending || refresh.revision !== initialRevision.current;
  const active = !left.current && !invalidated && current === generation;
  useLayoutEffect(() => {
    if (invalidated || current !== generation) left.current = true;
  }, [invalidated, current, generation]);
  return (
    <SWRSeedBoundary seed={active ? seed : NO_SEED}>
      <ShellCacheSeeder entries={active ? seed.fallback : NO_ENTRIES} />
      {children}
    </SWRSeedBoundary>
  );
}

/**
 * Tenant-scoped providers.
 *
 * SessionProvider reads the tenant cookie ("{TENANT_DOMAIN-derived}.session-token")
 * via the default basePath "/api/auth". This cookie is shared across
 * tenant subdomains for tenant-to-tenant switching.
 *
 * The read-only server session snapshot hydrates SessionProvider without
 * running refresh-capable auth callbacks in a Server Component. The provider
 * polls its response-aware route later; SessionCachePrimer shares the current
 * value with non-React API clients. `shell` is the server preload (#2973);
 * missing fields retain their client fetch path.
 */
// The school's login explains that the session ended (#8082).
const tenantExpiredLogin = () => "/?error=SessionExpired";

export function TenantProviders({
  children,
  tenantSlug,
  tenant,
  routingMode,
  session,
  sessionMark,
  shell = null,
}: Readonly<{
  children: React.ReactNode;
  tenantSlug: string;
  tenant: TenantInfo;
  routingMode: TenantRoutingMode;
  session?: Session | null;
  /** The session mark the page was rendered with (#8082). */
  sessionMark: string;
  shell?: ShellBootstrap | null;
}>) {
  const swrSeed = useMemo(() => {
    if (!shell) return null;
    const config = shellSwrConfig(shell, tenantSlug);
    // The seed belongs to the generation it was built in (#5006): after a
    // drop of one of its keys no reader shows it, also not as fallback.
    stampSWRSeeds(config.fallback);
    return config;
  }, [shell, tenantSlug]);
  // The seed belongs to the session the server rendered with.
  const seedGeneration = authGeneration(session);
  // A logout stops the poll at once (#5399).
  const pollSeconds = useSessionPollInterval(SESSION_PROVIDER_POLL_SECONDS);
  const mark = useMemo(
    () => ({
      name: sessionMarkName("tenant", clientEnv.NEXT_PUBLIC_TENANT_DOMAIN),
      rendered: sessionMark,
    }),
    [sessionMark],
  );

  const providers = (
    <ShellSeedProvider value={shell}>
      <TenantProvider
        tenantSlug={tenantSlug}
        tenant={tenant}
        routingMode={routingMode}
      >
        {/* Inside the tenant context: it reads the push key under the same
            cache scope as the guided setup and the settings card. */}
        <PushSubscriptionSync portal="tenant" />
        <SupervisionProvider>
          <TenantAuthWrapper>
            <ProfileProvider initialProfile={shell?.profile ?? null}>
              {children}
            </ProfileProvider>
          </TenantAuthWrapper>
        </SupervisionProvider>
      </TenantProvider>
    </ShellSeedProvider>
  );

  return (
    <SessionProvider
      session={session ?? undefined}
      refetchInterval={pollSeconds}
      refetchOnWindowFocus={false}
    >
      <StaleSessionMarkCheck sessionMark={mark} />
      <SessionAccountBinding />
      <PersonalStorageGuard
        homeHref={() => tenantAwarePath("/", tenantSlug, routingMode)}
      />
      <SWRScopeBoundary expectedTenantId={tenant.tenantId} />
      <SessionCachePrimer />
      <SentrySessionContext portal="tenant" />
      {/* Everything that shows or holds this session's data (#8082). */}
      <SessionTreeBoundary
        portal="tenant"
        sessionMark={mark}
        endedSessionUrl={tenantExpiredLogin}
      >
        <ModuleBookingAudienceBridge>
          {swrSeed ? (
            <ShellSwrSeed seed={swrSeed} generation={seedGeneration}>
              {providers}
            </ShellSwrSeed>
          ) : (
            providers
          )}
        </ModuleBookingAudienceBridge>
      </SessionTreeBoundary>
    </SessionProvider>
  );
}
