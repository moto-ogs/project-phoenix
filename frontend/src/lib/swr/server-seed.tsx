"use client";

/**
 * Page data the server loaded for a session before the browser asked (#8077).
 *
 * A server loader starts a page's reads at request time and hands them over
 * as one `ServerSeed`: the factory keys the browser readers use and, per key,
 * a promise of the complete value (undefined when the server has none). This
 * boundary passes them to the existing readers in two ways, both under the
 * generation lock:
 *
 * - On the server render and its hydration, entries marked `render` are
 *   awaited (inside the page's Suspense boundary) and become SWR `fallback`,
 *   so the HTML shows them. Stamped like the shell seeds (#5006).
 * - Every entry, and every key the page `claims` before the seed resolved, is
 *   offered once as a locked intent preload of its key. The reader's mount
 *   load takes that preload instead of a browser request; a newer cached value
 *   or a running read keeps its place (intent rules of useSWRPreload).
 *
 * The browser path stays the recovery: a key the server could not load, a
 * seed of another session generation, an old one (back navigation, a stale
 * prefetch) or a broken stream make the preload a DiscardedAnswer, and the
 * reader loads as it always did, with its error and retry path. A seed is
 * offered at most once, and its fallback ends for good once the session's
 * generation left it.
 */

import { useSession } from "next-auth/react";
// swr/no-direct-import permits package imports inside this shared wrapper only.
import { useSWRConfig } from "swr";
import {
  use,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { SWRSeedBoundary } from "./config-boundaries";
import {
  DiscardedAnswer,
  isCurrentSWRValue,
  wasDroppedInScope,
  wasDroppedWithin,
} from "./generation";
import { useSWRCacheKey, useSWRPreload } from "./hooks";
import { authGeneration, useSWRSessionRefresh } from "./scope";
import { stampSWRSeeds } from "./seed";

export interface ServerSeedEntry {
  /** The unscoped factory key the browser reader builds. */
  readonly key: string;
  /** The complete value, or undefined when the server has none. Never rejects. */
  readonly value: Promise<unknown>;
  /** The server render waits for it and shows it at once. */
  readonly render?: boolean;
}

export interface ServerSeed {
  /** When the server started the loads (ms since epoch). */
  readonly builtAt: number;
  /** `sessionGeneration` of the snapshot the loads ran with. */
  readonly generation: string;
  readonly entries: readonly ServerSeedEntry[];
}

/**
 * Keys a page derives from a value the cache already holds (a client
 * navigation): the derived keys are claimed like `claims`. Read once when
 * the seed is offered; nothing loads or subscribes for it.
 */
export interface ServerSeedClaimsFrom<T> {
  readonly key: string;
  readonly derive: (cached: T) => readonly string[];
}

export type ServerSeedInput =
  ServerSeed | Promise<ServerSeed | null> | null | undefined;

/**
 * A seed older than this does not stand in for the browser's read: a prefetch
 * that waited longer, or a page restored from the router cache.
 */
export const SERVER_SEED_MAX_AGE_MS = 30_000;

const NO_ENTRIES: Readonly<Record<string, unknown>> = {};
const NO_CLAIMS: readonly (string | null)[] = [];
const isServer = typeof window === "undefined";
// Seeds a mount already offered: a remount with the same payload (back
// navigation from the router cache, a remount after a scope change) offers
// nothing again and shows no fallback.
const offered = new WeakSet<object>();
// The keys each seed offered: a key offers once, also when the page claims it
// only later (a features key once the children list is known).
const offeredKeys = new WeakMap<object, Set<string>>();
// The fallback built for a seed, per scope prefix, so every render of the
// boundary hands SWR the same object.
const fallbacks = new WeakMap<
  object,
  { prefix: string; entries: Record<string, unknown> }
>();

const subscribeNothing = () => () => {};

function isThenable(value: unknown): value is PromiseLike<ServerSeed | null> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/**
 * The value of `key` the seed may hand to the browser reader, or a discard.
 * `fullKey` is its scoped key: a drop of it since the server may have read it
 * (a refused child, a withdrawn relationship) leaves the read to the browser,
 * also for a prefetched payload that mounts only now.
 */
async function seededValue(
  seed: ServerSeed | PromiseLike<ServerSeed | null>,
  key: string,
  fullKey: string,
  generation: string,
): Promise<unknown> {
  let resolved: ServerSeed | null;
  try {
    resolved = await seed;
  } catch {
    throw new DiscardedAnswer();
  }
  const entry =
    resolved?.generation === generation &&
    Math.abs(Date.now() - resolved.builtAt) <= SERVER_SEED_MAX_AGE_MS
      ? resolved.entries.find((candidate) => candidate.key === key)
      : undefined;
  if (!entry) throw new DiscardedAnswer();
  let value: unknown;
  try {
    value = await entry.value;
  } catch {
    throw new DiscardedAnswer();
  }
  if (value === undefined || wasDroppedWithin(fullKey, SERVER_SEED_MAX_AGE_MS))
    throw new DiscardedAnswer();
  return value;
}

/**
 * Offers the seed's keys as locked intent preloads. A leaf before the page:
 * its layout effect runs before any reader below mounts and loads.
 */
function SeedHandoff({
  seed,
  resolved,
  claims,
  claimsFrom,
  generation,
}: Readonly<{
  seed: ServerSeed | PromiseLike<ServerSeed | null> | null;
  /** The seed as hydration read it: its keys are offered before any reader mounts. */
  resolved: ServerSeed | null;
  claims: readonly (string | null)[];
  claimsFrom: ServerSeedClaimsFrom<never> | undefined;
  generation: string | null;
}>) {
  const preload = useSWRPreload();
  const scoped = useSWRCacheKey();
  const { cache } = useSWRConfig();
  useLayoutEffect(() => {
    if (!seed || generation === null) return;
    offered.add(seed);
    let keys = offeredKeys.get(seed);
    if (!keys) {
      keys = new Set();
      offeredKeys.set(seed, keys);
    }
    const known = keys;
    const offer = (key: string) => {
      const fullKey = scoped(key);
      if (known.has(key) || fullKey === null) return;
      known.add(key);
      void preload(key, () => seededValue(seed, key, fullKey, generation), {
        intent: true,
      }).catch(() => undefined);
    };
    for (const key of claims) if (key !== null) offer(key);
    resolved?.entries.forEach((entry) => offer(entry.key));
    const source = claimsFrom ? scoped(claimsFrom.key) : null;
    if (claimsFrom && source !== null) {
      const cached = (cache.get(source) as { data?: unknown } | undefined)
        ?.data;
      if (cached !== undefined && isCurrentSWRValue(source, cached) === true)
        claimsFrom.derive(cached as never).forEach(offer);
    }
    if (isThenable(seed)) {
      void Promise.resolve(seed).then(
        (resolved) => resolved?.entries.forEach((entry) => offer(entry.key)),
        () => undefined,
      );
    } else {
      seed.entries.forEach((entry) => offer(entry.key));
    }
  }, [seed, resolved, claims, claimsFrom, generation, preload, scoped, cache]);
  return null;
}

/**
 * The boundary of a server seed. `claims` are keys the page knows before the
 * seed resolved (its own readers' keys); they wait for the seed instead of
 * loading in the browser. With `render`, the server render (and its
 * hydration) waits for the entries marked `render`: place it inside the
 * page's Suspense boundary. Without it (a shell), nothing waits.
 */
export function SWRServerSeed<T = never>({
  seed,
  claims = NO_CLAIMS,
  claimsFrom,
  render = false,
  children,
}: Readonly<{
  seed: ServerSeedInput;
  claims?: readonly (string | null)[];
  claimsFrom?: ServerSeedClaimsFrom<T>;
  render?: boolean;
  children: ReactNode;
}>) {
  // True for the server render and the hydration of its HTML, false for a
  // page the browser rendered itself (a client navigation).
  const hydrating = useSyncExternalStore(
    subscribeNothing,
    () => false,
    () => true,
  );
  const input = seed ?? null;
  const fresh = (candidate: object | null) =>
    candidate !== null && (isServer || !offered.has(candidate));
  const [opening, setOpening] = useState(() => ({
    seed: input,
    hydrating,
    fresh: fresh(input),
  }));
  const current =
    opening.seed === input
      ? opening
      : { seed: input, hydrating: false, fresh: fresh(input) };
  if (current !== opening) setOpening(current);

  const { data: session, status } = useSession();
  const generation = status === "loading" ? null : authGeneration(session);
  const scoped = useSWRCacheKey();
  const refresh = useSWRSessionRefresh();
  const initialRevision = useRef(refresh.revision);
  const left = useRef(false);
  const invalidated =
    refresh.pending || refresh.revision !== initialRevision.current;

  let seedGeneration: string | null = null;
  let entries: Record<string, unknown> = NO_ENTRIES;
  let resolved: ServerSeed | null = null;
  if (render && current.hydrating && current.fresh && current.seed) {
    resolved = isThenable(current.seed)
      ? use(current.seed as Promise<ServerSeed | null>)
      : current.seed;
    seedGeneration = resolved?.generation ?? null;
    const prefix = scoped("");
    if (
      resolved &&
      prefix !== null &&
      !left.current &&
      !invalidated &&
      resolved.generation === generation
    ) {
      const values: [string, unknown][] = [];
      for (const entry of resolved.entries) {
        if (!entry.render) continue;
        const value = use(entry.value);
        if (value !== undefined) values.push([entry.key, value]);
      }
      entries = fallbackFor(current.seed, prefix, values, scoped);
    }
  }
  useLayoutEffect(() => {
    if (
      invalidated ||
      (seedGeneration !== null && seedGeneration !== generation)
    )
      left.current = true;
  }, [invalidated, seedGeneration, generation]);

  const config = useMemo(
    () => ({ fallback: entries, cacheData: NO_ENTRIES }),
    [entries],
  );
  return (
    <SWRSeedBoundary seed={config}>
      <SeedHandoff
        seed={current.fresh ? current.seed : null}
        resolved={resolved}
        claims={claims}
        claimsFrom={claimsFrom as ServerSeedClaimsFrom<never> | undefined}
        generation={generation}
      />
      {children}
    </SWRSeedBoundary>
  );
}

function fallbackFor(
  seed: object,
  prefix: string,
  values: readonly [string, unknown][],
  scoped: (key: string) => string | null,
): Record<string, unknown> {
  const known = fallbacks.get(seed);
  if (known?.prefix === prefix) return known.entries;
  const built: Record<string, unknown> = {};
  for (const [key, value] of values) {
    const full = scoped(key);
    // The server HTML is as old as the page: a key dropped at any time since
    // (another boundary hydrated first and was refused) shows nothing old,
    // also not for one render.
    if (full !== null && !wasDroppedInScope(full)) built[full] = value;
  }
  // The fallback belongs to the generation it was shown in (#5006): after a
  // drop of one of its keys no reader shows it.
  stampSWRSeeds(built);
  if (!isServer) fallbacks.set(seed, { prefix, entries: built });
  return built;
}
