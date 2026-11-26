/**
 * Cache scope of ~/lib/swr (#5006): which session a cache entry belongs to,
 * and how the cache is dropped at the boundary of that session.
 *
 * Two values describe a session:
 * - the scope prefix (portal, school, account) starts every key the wrappers
 *   build, so no entry of one account is ever read under another account's
 *   key, even by a late response or a stale closure;
 * - the auth generation (scope, school or Träger, account, preview target,
 *   roles and permissions) marks every change after which no entry may stay:
 *   login, logout, account, school, preview or rights change. SWRScopeBoundary
 *   resets the cache whenever it changes.
 *
 * Whether data or an answer still counts is decided by the generation lock
 * (generation.ts); the drops here raise its generations first and then free
 * the cache.
 *
 * The browser session has no session ID of its own (#5005); the generation
 * stands in for it. A new sign-in of the same account with the same rights
 * keeps the cache: its entries show exactly what the new session may see.
 */

import type { Session } from "next-auth";
import { useSyncExternalStore } from "react";
// swr/no-direct-import permits package imports inside this shared wrapper only.
import { unload, type Cache } from "swr";
import { SWRGlobalState, createCacheHelper, getTimestamp } from "swr/_internal";
import { isRefusal } from "~/lib/access-refusal";
import type { ErrorCode } from "~/lib/error-codes.generated";
import { clearListOverlays } from "~/lib/list-overlays";
import {
  bumpDataGeneration,
  bumpRequestGeneration,
  bumpScopeGeneration,
  dataGenerationOf,
  plainSWRKey,
  stampSWRError,
} from "./generation";
import { hasSessionAccess } from "~/lib/session-access";
import { sessionGeneration } from "./session-generation";
import { sessionTreeState, subscribeSessionTree } from "~/lib/session-tree";

type MaybeSession = Session | null | undefined;

const generations = new WeakMap<Session, string>();

/**
 * The auth generation of a session; null while it grants no access. Built
 * once per session object, since every SWR hook asks on every render.
 */
export function authGeneration(session: MaybeSession): string | null {
  if (!hasSessionAccess(session)) return null;
  const known = generations.get(session);
  if (known !== undefined) return known;
  const generation = sessionGeneration(session);
  if (generation !== null) generations.set(session, generation);
  return generation;
}

/** Scope prefix of the tenant portal: the school's slug and the account. */
export function tenantSWRScope(tenantSlug: string, accountId: string): string {
  return `${tenantSlug}:${accountId}`;
}

/**
 * The prefix of every key the wrappers build for this session; null while
 * the session grants no access, so nothing is fetched. Inside a
 * TenantProvider the school is the URL's slug. The school portal has no
 * TenantProvider and is bound to the school of its session.
 */
export function swrScopePrefix(
  session: MaybeSession,
  tenantSlug: string | null,
): string | null {
  if (!hasSessionAccess(session) || !session.user.id) return null;
  const { id, scope, tenantId, orgId } = session.user;
  // Operators read across schools: only their account scopes the session.
  if (scope === "platform") return `operator:${id}`;
  // The Träger is the isolation boundary here, not one of its schools.
  if (scope === "org") {
    return orgId == null ? null : `traeger:${orgId}:${id}`;
  }
  if (scope === "caterer") return `caterer:${id}`;
  if (tenantSlug) return tenantSWRScope(tenantSlug, id);
  if (scope === "school") {
    return tenantId == null ? null : `school:${tenantId}:${id}`;
  }
  return `${scope || "tenant"}:${tenantId ?? orgId ?? "-"}:${id}`;
}

/** A key of the scope `prefix`. */
export function scopedSWRKey(prefix: string, key: string): string {
  return `${prefix}:${key}`;
}

// The cleanup below frees memory and lets mounted hooks load again; safety
// comes from the generation lock. Tests switch the cleanup off to prove that.
let cleanupEnabled = true;

/** Only for tests: run the drops without their cleanup. */
export function _setSWRCleanupForTests(enabled: boolean): void {
  cleanupEnabled = enabled;
}

// Cross-tab invalidation must take effect before React commits new keys or
// SessionProvider answers. The revision also permanently withdraws shell seeds.
// `signedOut`: the other tab cleared the owner (its session ended).
const initialRefresh = { pending: false, signedOut: false, revision: 0 };
let sessionRefresh = initialRefresh;
const refreshListeners = new Set<() => void>();

function subscribeRefresh(listener: () => void): () => void {
  refreshListeners.add(listener);
  return () => {
    refreshListeners.delete(listener);
  };
}

export function useSWRSessionRefresh() {
  return useSyncExternalStore(
    subscribeRefresh,
    () => sessionRefresh,
    () => initialRefresh,
  );
}

export function isSWRSessionPending(): boolean {
  return sessionRefresh.pending;
}

export function suspendSWRSession(signedOut = false): void {
  sessionRefresh = {
    pending: true,
    signedOut,
    revision: sessionRefresh.revision + 1,
  };
  for (const listener of refreshListeners) listener();
}

export function resumeSWRSession(): void {
  if (!sessionRefresh.pending) return;
  sessionRefresh = { ...sessionRefresh, pending: false };
  for (const listener of refreshListeners) listener();
}

/**
 * The paused session is confirmed: clear the cache while still paused (old
 * subscribers may not have committed their disabled keys yet), then let the
 * reads go on. The null → scoped key transition loads the confirmed
 * session, immutable readers included.
 */
export function confirmSWRSession(): void {
  resetSWRScope({ revalidate: false });
  resumeSWRSession();
}

const scopeResetListeners = new Set<() => void>();

/**
 * Runs `listener` on every session boundary resetSWRScope marks (login,
 * logout, another account, also from another tab), before the cache goes.
 * For state that belongs to the cache's session but lives outside it, such
 * as the refusals of use-traeger-confirmed-resource. Returns the
 * unsubscribe.
 */
export function onSWRScopeReset(listener: () => void): () => void {
  scopeResetListeners.add(listener);
  return () => scopeResetListeners.delete(listener);
}

/**
 * Ends the scope generation (generation.ts), then drops the whole cache of
 * this tab: every entry including the
 * `useSWRInfinite` and `useSWRSubscription` keys, preloads, requests and
 * mutations in flight (their answers are discarded), the data
 * `keepPreviousData` holds on screen, and the list overlays (#5124).
 *
 * `revalidate` lets mounted hooks of an unchanged key load again; pass it
 * only when the session already in place is the one they should load for.
 */
export function resetSWRScope({ revalidate }: { revalidate: boolean }): void {
  bumpScopeGeneration();
  for (const listener of scopeResetListeners) listener();
  if (!cleanupEnabled) return;
  clearListOverlays();
  unload({ revalidate });
}

/**
 * Drops this tab's whole cache because the session cookie changed under it
 * (#8082: another subdomain replaced the shared tenant cookie). Nothing
 * loads again until a reader of the confirmed session mounts.
 */
export function dropSWRSession(): void {
  resetSWRScope({ revalidate: false });
}

// A document that leaves its session (logout, school switch, another account,
// pagehide) ends the tree's work with it: a read, prefetch or seed still
// running writes nothing into the cache (#8082).
subscribeSessionTree(() => {
  if (sessionTreeState().leaving) dropSWRSession();
});

/**
 * Whether `error` is the server's refusal of an entity with one of `codes`.
 * Programs branch on the code (ADR 0006), never on a message.
 */
export function isEntityRefusal(
  error: unknown,
  codes: readonly ErrorCode[],
): boolean {
  return (
    isRefusal(error) && error.code !== undefined && codes.includes(error.code)
  );
}

/**
 * How invalidateSWRKeys treats the keys it collects.
 * - `revalidate`: mounted readers load again; no later reader reuses a
 *   request or preload from before (data stays until the answer).
 * - `expire-inactive`: same for mounted readers, clear the unmounted entries.
 * - `clear`: data, error and loading state go; nothing is fetched.
 * - `discard`: like `clear`, but an error stays, so a view shows the
 *   refusal instead of the data.
 */
export type SWRInvalidation =
  "revalidate" | "expire-inactive" | "clear" | "discard";

/**
 * The one way to invalidate part of the cache (#5006; the whole cache goes
 * through resetSWRScope). It raises the generation of the matching keys
 * (generation.ts): `revalidate` the request generation of the keys SWR
 * holds now, `clear` and `discard` the data generation of every key
 * `matches`, also of keys that appear only later. The rest is cleanup. `matches` gets every key SWR 2.5.1 holds state
 * for, without its `$inf$`/`$sub$` marker, from every place that state
 * lives: cache entries (also without a reader's `_k`), mounted hooks
 * (EVENT_REVALIDATORS), requests in flight and finished requests inside the
 * dedupe window (FETCH), preloads (PRELOAD) and mutations (MUTATION).
 * SWR's own key filter (`mutate(fn)`) sees only cache entries a mounted
 * hook keyed, and skips `$inf$`/`$sub$`.
 *
 * Every collected key loses its request and preload, so no reader reuses
 * an answer from before. `clear` and `discard` also stamp the mutation
 * clock, which makes requests and mutations in flight, their rollbacks
 * included, write nothing back, and empty the entry without leaving it in a
 * loading state.
 */
export function invalidateSWRKeys(
  cache: Cache,
  matches: (key: string) => boolean,
  mode: SWRInvalidation,
  /** `discard`: the refusal that stays visible. */
  refusal?: unknown,
  /** Explicit failing key when the refusal came from outside SWR's fetcher. */
  refusedKey?: string,
): Promise<unknown[]> {
  const state = SWRGlobalState.get(cache);
  const keys = new Set<string>(cache.keys());
  if (state) {
    const [EVENT_REVALIDATORS, MUTATION, FETCH, PRELOAD] = state;
    for (const family of [EVENT_REVALIDATORS, MUTATION, FETCH, PRELOAD]) {
      for (const key of Object.keys(family)) keys.add(key);
    }
  }
  const matched = [...keys].filter((key) => matches(plainSWRKey(key)));
  // The lock first: it holds also for keys the cleanup cannot see.
  if (mode === "revalidate" || mode === "expire-inactive")
    bumpRequestGeneration(matched);
  else bumpDataGeneration(matches);
  // `discard` keeps the refusal on screen: that failure counts in the new
  // generation, everything else of the keys does not.
  if (mode === "discard" && refusal !== undefined) {
    for (const key of matched) {
      if (key === refusedKey || cache.get(key)?.error === refusal) {
        stampSWRError(refusal, dataGenerationOf(key));
      }
    }
  }
  if (!cleanupEnabled || matched.length === 0) return Promise.resolve([]);
  const revalidations: Promise<unknown>[] = [];
  for (const key of matched) {
    if (state) {
      const [EVENT_REVALIDATORS, MUTATION, FETCH, PRELOAD, scopedMutate] =
        state;
      delete FETCH[key];
      delete PRELOAD[key];
      if (
        mode === "revalidate" ||
        (mode === "expire-inactive" && EVENT_REVALIDATORS[key]?.length)
      ) {
        // SWR's own revalidation of one key: the first mounted hook loads.
        revalidations.push(scopedMutate(key));
        continue;
      }
      // Like unload: an older request or mutation fails its timestamp check
      // on resolution and writes nothing back, not even its rollback.
      const ts = getTimestamp();
      MUTATION[key] = [ts, ts];
    }
    if (mode === "revalidate" || cache.get(key) === undefined) continue;
    if (!state) {
      cache.delete(key);
      continue;
    }
    const [, set] = createCacheHelper(cache, key);
    // `_c` holds the data an optimistic update replaced; SWR's State type
    // does not name it. A request discarded here never resets the loading
    // flags itself.
    set({
      data: undefined,
      _c: undefined,
      isValidating: false,
      isLoading: false,
      ...(mode === "clear" || mode === "expire-inactive"
        ? { error: undefined }
        : {}),
      ...(mode === "discard" && key === refusedKey ? { error: refusal } : {}),
    } as Parameters<typeof set>[0]);
  }
  return Promise.all(revalidations);
}

/**
 * Drops every entry of scope `prefix` whose unscoped key `matches`, wherever
 * SWR keeps it (invalidateSWRKeys, `discard`). Nothing is fetched again;
 * `refusal`, where an entry holds it, stays visible.
 */
export function discardScopedEntries(
  cache: Cache,
  prefix: string,
  matches: (key: string) => boolean,
  refusal?: unknown,
  refusedKey?: string,
): void {
  const scope = `${prefix}:`;
  void invalidateSWRKeys(
    cache,
    (key) => key.startsWith(scope) && matches(key.slice(scope.length)),
    "discard",
    refusal,
    refusedKey === undefined ? undefined : scopedSWRKey(prefix, refusedKey),
  );
}
