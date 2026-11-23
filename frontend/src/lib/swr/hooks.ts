/**
 * Custom SWR Hooks with Authentication and Tenant Integration
 *
 * These hooks wrap SWR with NextAuth session awareness and scoped cache
 * keys, ensuring requests only fire when the user is authenticated and the
 * cache is isolated per school and account (#5006).
 *
 * Every key starts with the session's scope prefix (scope.ts): inside a
 * TenantProvider the tenant slug and the account
 * (`school-a:42:students-list`), in the school portal its school and
 * account, in the other portals the portal, school or Träger, and account.
 */

"use client";

// swr/no-direct-import permits package imports inside this shared wrapper only.
import useSWR, {
  mutate as swrMutate,
  useSWRConfig,
  type Cache,
  type Middleware,
  type SWRConfiguration,
  type SWRResponse,
  type MutatorOptions,
} from "swr";
import { SWRGlobalState, cache as defaultSWRCache } from "swr/_internal";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useSession } from "next-auth/react";
import { swrConfig, immutableConfig } from "./config";
import { createLogger } from "~/lib/logger";
import {
  isAccessRefusal,
  isReadRefusal,
  liftAllRefusals,
  liftRefusal,
  markRefused,
  noteShownDataRefusal,
  refusalFor,
  subscribeRefusals,
} from "~/lib/access-refusal";
import {
  DiscardedAnswer,
  currentSWRDataGeneration,
  currentSWRGeneration,
  dataGenerationOf,
  isCurrentSWRError,
  isCurrentSWRValue,
  isDiscardedAnswer,
  isVisibleSWRValue,
  isFallbackVisible,
  noteFallbackShown,
  isStillCurrent,
  lockFetcher,
  subscribeSWRDataGeneration,
  lockMutation,
  requestGenerationOf,
  startOf,
  preloadSWR,
  expireIntentPreload,
  type SWRMutationRun,
} from "./generation";
import {
  authGeneration,
  onSWRScopeReset,
  isSWRSessionPending,
  useSWRSessionRefresh,
  discardScopedEntries,
  invalidateSWRKeys,
  isEntityRefusal,
  scopedSWRKey,
  swrScopePrefix,
} from "./scope";
import type { ErrorCode } from "~/lib/error-codes.generated";
import { useTenantSlugSafe } from "~/lib/tenant-context";

// A refusal belongs to the session that got it.
onSWRScopeReset(liftAllRefusals);

/**
 * The scope of the signed-in session: the prefix of every key the wrappers
 * build (null without access, nothing is fetched) and its auth generation.
 * For keys built outside the wrappers, e.g. a server seed or a key factory.
 */
function useSWRScope(): {
  prefix: string | null;
  generation: string | null;
} {
  const { data: session, status } = useSession();
  const slug = useTenantSlugSafe();
  const { pending } = useSWRSessionRefresh();
  if (pending || status === "loading")
    return { prefix: null, generation: null };
  return {
    prefix: swrScopePrefix(session, slug),
    generation: authGeneration(session),
  };
}

/**
 * The write side of the generation lock (generation.ts) on the merged
 * configuration of every wrapper hook:
 * - the fetcher discards an answer whose generation ended while it ran,
 *   also when SWR hands over a preload or a deduped request;
 * - an error retry scheduled before a bump does not run after it;
 * - a discarded answer is no error: not logged, not retried;
 * - while another tab's session is being confirmed nothing revalidates.
 *   The live flag is read because a timer or mutation can run before React
 *   commits the disabled keys after an owner-change event.
 */
type OnSuccess = NonNullable<SWRConfiguration["onSuccess"]>;
type OnError = NonNullable<SWRConfiguration["onError"]>;
type Compare = NonNullable<SWRConfiguration["compare"]>;
type OnErrorRetry = NonNullable<SWRConfiguration["onErrorRetry"]>;

const generationLockMiddleware: Middleware =
  (useSWRNext) => (key, fetcher, config) => {
    const locked =
      typeof key === "string" && fetcher ? lockFetcher(key, fetcher) : fetcher;
    const onSuccess: OnSuccess = (data, successKey, current) => {
      // Every successful read lifts a refusal, even without a resource guard.
      // Cache writes never come through this callback.
      liftRefusal(successKey);
      config.onSuccess?.(data, successKey, current);
    };
    const onError: OnError = (error, errorKey, current) => {
      if (isDiscardedAnswer(error)) return;
      // SWR keeps the data next to a refusal; useRefreshAfterWrite learns
      // of it here, since the revalidation itself never rejects (#6801).
      const shown = (current as { cache?: Cache }).cache?.get(errorKey)?.data;
      if (isAccessRefusal(error) && shown !== undefined) noteShownDataRefusal();
      // Every reader of the key stops showing its data (useScopedSWR)
      // until a read succeeds; SWR alone would keep it next to the error.
      if (isReadRefusal(error)) markRefused(errorKey, error);
      config.onError?.(error, errorKey, current);
    };
    const onErrorRetry: OnErrorRetry = (
      error,
      errorKey,
      current,
      revalidate,
      options,
    ) => {
      if (isDiscardedAnswer(error)) return;
      const start = startOf(errorKey);
      config.onErrorRetry?.(
        error,
        errorKey,
        current,
        (retry) => {
          if (isStillCurrent(errorKey, start)) return revalidate(retry);
        },
        options,
      );
    };
    // Values of different generations are never equal, in either order:
    // SWR keeps the cached reference on a match when an answer arrives, and
    // keeps its last snapshot on a match when the cache changes. Either
    // would leave the stamp of the old value on screen (hidden).
    const compare: Compare = (a, b) => {
      if (Object.is(a, b)) return true;
      if (
        typeof key === "string" &&
        isCurrentSWRValue(key, a) !== isCurrentSWRValue(key, b)
      ) {
        return false;
      }
      return config.compare?.(a, b) ?? false;
    };
    return useSWRNext(key, locked, {
      ...config,
      compare,
      isPaused: () => {
        // SWR checks this before invoking its built-in preload consumer.
        // Read-time expiry also covers suspended background-tab timers.
        if (typeof key === "string") expireIntentPreload(key);
        return isSWRSessionPending() || config.isPaused?.() === true;
      },
      onSuccess,
      onError,
      onErrorRetry,
    });
  };

/**
 * The value a revalidation or clear resolves to, only while it belongs to
 * the key's current generation: after a discarded revalidation SWR resolves
 * to whatever the cache still holds.
 */
function currentResult<V>(
  key: string,
  result: Promise<V>,
): Promise<V | undefined> {
  return Promise.resolve(result).then((value) =>
    isVisibleSWRValue(key, value) ? value : undefined,
  );
}

/**
 * The result of a data mutation, only while its own run still counts (G25):
 * judged by the run's start token, never by the result equalling a value
 * stamped since. A run ended by a scope or data bump resolves to undefined.
 */
function runResult<V>(
  run: SWRMutationRun,
  result: Promise<V>,
): Promise<V | undefined> {
  return Promise.resolve(result).then(
    (value) => {
      run.done();
      return run.isCurrent() ? value : undefined;
    },
    (error: unknown) => {
      run.done();
      throw error;
    },
  );
}

/**
 * The options a reader of ~/lib/swr takes (#5007), an allowlist in type and
 * at runtime. Each is checked against the generation lock:
 * - timing only, every load still runs the locked fetcher:
 *   `dedupingInterval`, `focusThrottleInterval`, `refreshInterval`,
 *   `revalidateIfStale`, `revalidateOnFocus`, `revalidateOnMount`,
 *   `revalidateOnReconnect`;
 * - retries, which the lock drops after a generation moved:
 *   `errorRetryCount`, `shouldRetryOnError`;
 * - read-side values the lock judges: `fallbackData` (shown only under the
 *   fallback rules), `keepPreviousData` (only while no generation moved);
 * - `isPaused`, which can only add pauses to the session pause;
 * - `onSuccess` and `onError`, called with the value or failure alone,
 *   never with SWR's configuration and its cache or mutate.
 * Left out on purpose: `use` (a middleware gets raw useSWR and its mutate),
 * `provider`, `fallback`, `fetcher`, `compare`, `onErrorRetry` and every
 * other key of SWRConfiguration.
 */
export const READER_OPTION_KEYS = [
  "dedupingInterval",
  "errorRetryCount",
  "fallbackData",
  "focusThrottleInterval",
  "isPaused",
  "keepPreviousData",
  "onError",
  "onSuccess",
  "refreshInterval",
  "revalidateIfStale",
  "revalidateOnFocus",
  "revalidateOnMount",
  "revalidateOnReconnect",
  "shouldRetryOnError",
] as const satisfies readonly (keyof SWRConfiguration)[];

export type ReaderOptions<T, E = Error> = Pick<
  SWRConfiguration<T, E>,
  Exclude<(typeof READER_OPTION_KEYS)[number], "onSuccess" | "onError">
> & {
  onSuccess?: (data: T) => void;
  onError?: (error: E) => void;
};

/**
 * The options of a mutation through ~/lib/swr. lockMutation stamps
 * `optimisticData` and guards `populateCache`; the others decide only
 * whether to revalidate, roll back or throw.
 */
export const MUTATION_OPTION_KEYS = [
  "optimisticData",
  "populateCache",
  "revalidate",
  "rollbackOnError",
  "throwOnError",
] as const satisfies readonly (keyof MutatorOptions)[];

const allowedReaderKeys = new Set<string>(READER_OPTION_KEYS);
const allowedMutationKeys = new Set<string>(MUTATION_OPTION_KEYS);
// A clear writes nothing but `undefined`: it may revalidate and report a
// failed revalidation, never populate or show optimistic data.
const clearOptionKeys = new Set<string>(["revalidate", "throwOnError"]);

/**
 * Copies the allowed keys of `options`; any other key throws outside
 * production and is dropped in production. Copied, never spread: a key the
 * type let through by assignability does not reach SWR.
 */
function copyAllowed(
  options: object | undefined,
  allowed: ReadonlySet<string>,
  kind: string,
): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  if (options === undefined || options === null) return copy;
  for (const [name, value] of Object.entries(options)) {
    if (allowed.has(name)) copy[name] = value;
    else if (process.env.NODE_ENV !== "production")
      throw new TypeError(`~/lib/swr ${kind} takes no option '${name}'`);
  }
  return copy;
}

function readerConfig<T, E>(
  options: ReaderOptions<T, E> | undefined,
): SWRConfiguration<T, E> {
  const { onSuccess, onError, ...rest } = copyAllowed(
    options,
    allowedReaderKeys,
    "reader",
  ) as ReaderOptions<T, E>;
  return {
    ...rest,
    ...(onSuccess ? { onSuccess: (data: T) => onSuccess(data) } : {}),
    ...(onError ? { onError: (error: E) => onError(error) } : {}),
  };
}

function mutationOptions(options: unknown): unknown {
  return typeof options === "object" && options !== null
    ? copyAllowed(options, allowedMutationKeys, "mutation")
    : options;
}

const logger = createLogger({ component: "useSWRAuth" });

/**
 * Safari reports `undefined is not a function` when SWR's mutate finds no
 * state for the cache it is bound to (#2459). Not reproduced locally; this
 * records whether the hook's cache was registered at that moment. The
 * error still reaches the caller.
 */
function reportMutateTypeError<V>(cache: Cache, result: Promise<V>): void {
  Promise.resolve(result).catch((error: unknown) => {
    if (!(error instanceof TypeError)) return;
    logger.warn("swr_mutate_type_error", {
      error: error.message,
      cache_registered: SWRGlobalState.has(cache),
      default_cache: cache === defaultSWRCache,
      default_cache_registered: SWRGlobalState.has(defaultSWRCache),
      visibility: document.visibilityState,
    });
  });
}

/** A bound mutate of `key` whose writes go through the generation lock. */
function lockBoundMutate<T>(
  key: string | null,
  cache: Cache,
  mutate: ReturnType<typeof useSWRConfig>["mutate"],
  dataGeneration: number,
): SWRResponse<T>["mutate"] {
  return ((...args: unknown[]) => {
    // An action may retain this callback while awaiting an API response.
    // It must not introduce that response into a later data generation.
    if (
      key === null ||
      isSWRSessionPending() ||
      dataGenerationOf(key) !== dataGeneration
    )
      return Promise.resolve(undefined);
    // SWR's bound mutate follows the hook's latest key. A retained callback
    // must write to the same captured key that its generation lock checks.
    // SWR counts the arguments: `mutate()` revalidates, while an explicit
    // `undefined` clears the entry. A clear takes only `revalidate` and
    // `throwOnError`: populateCache or optimisticData would write past the
    // lock.
    if (args[0] === undefined) {
      if (args.length === 0) {
        const revalidation = mutate(key);
        reportMutateTypeError(cache, revalidation);
        return currentResult(key, revalidation);
      }
      const clear = copyAllowed(
        typeof args[1] === "boolean"
          ? { revalidate: args[1] }
          : ((args[1] ?? undefined) as object | undefined),
        clearOptionKeys,
        "clear",
      );
      const cleared = mutate(key, undefined, clear as never);
      reportMutateTypeError(cache, cleared);
      return currentResult(key, cleared);
    }
    const [locked, lockedOptions, run] = lockMutation(
      key,
      args[0],
      mutationOptions(args[1]),
    );
    const written = mutate(key, locked as never, lockedOptions as never);
    reportMutateTypeError(cache, written);
    return runResult(run, written);
  }) as SWRResponse<T>["mutate"];
}

/**
 * useSWR under the session's scope and the generation lock (#5006).
 *
 * Read side: `data` (cache, `fallbackData`, a seed) is shown only while it
 * belongs to the key's current data generation; otherwise the hook reports
 * no data, and loads again once if no error explains the gap. An answer the
 * lock discarded is no error. A hook whose request was discarded loads
 * again under the new generation. Without a bump nothing loads again.
 *
 * `keepPreviousData` keeps an earlier key's data on screen only while no
 * generation moved since it arrived: a new key after an account switch, a
 * logout or a discard starts empty. The marker moves once data of the
 * current key arrived.
 *
 * Access refusal: after the server refused a read of the key (401, 403), no
 * reader of it shows data until a read succeeds. A later 5xx, a network
 * failure or a cache write does not bring the data back. Logout and an
 * account switch lift every refusal.
 */
type ScopedSWRResponse<T, E> = SWRResponse<T, E> & {
  /** Current protected values, including between renders. Never raw cache. */
  readCurrent?(): { data: T | undefined; error: E | undefined };
};

function useScopedSWR<T, E>(
  key: string | null,
  fetcher: () => Promise<T>,
  options: ReaderOptions<T, E> | undefined,
  base: SWRConfiguration = swrConfig,
  revalidateMissing = true,
): ScopedSWRResponse<T, E> {
  const { prefix, generation } = useSWRScope();
  const { cache, mutate: cacheMutate, fallback } = useSWRConfig();
  const fullKey =
    key !== null && prefix !== null ? scopedSWRKey(prefix, key) : null;
  // Renders again whenever values stop counting (scope or data bump).
  const moved = useSyncExternalStore(
    subscribeSWRDataGeneration,
    currentSWRDataGeneration,
    currentSWRDataGeneration,
  );
  const shown = useRef({ generation, moved });
  const configured = options?.keepPreviousData ?? base.keepPreviousData;
  const keep =
    configured === true &&
    shown.current.generation === generation &&
    shown.current.moved === moved;

  // The public fetcher contract has no SWR key argument. In particular a
  // factory's optional params must not receive the full scoped cache key.
  const response = useSWR<T, E>(fullKey, () => fetcher(), {
    ...(base as SWRConfiguration<T, E>),
    ...readerConfig(options),
    keepPreviousData: keep,
    use: [generationLockMiddleware],
  });

  const raw = response.data;
  const rawError = response.error;
  const discarded = isDiscardedAnswer(rawError);
  // The value this hook showed last: SWR's previous data under
  // `keepPreviousData`, which belongs to an earlier key.
  const lastShown = useRef<unknown>(undefined);
  // Every read path, against "nothing of an older generation is visible":
  // - a value ~/lib/swr produced (fetch, preload, mutation, seed) by its
  //   stamp;
  // - previous data of an earlier key only under the keep guard above;
  // - the caller's `fallbackData` or a provider fallback without a stamp by
  //   the key's fallback state, which a drop ends until fresh data came;
  // - any other value without a stamp (its stamp released at a scope
  //   boundary, #5223) only while no release or drop could have hit it;
  // - without a session nothing, not even `fallbackData`; a key the caller
  //   left out keeps SWR's own behaviour under the keep guard;
  // - a failure by its stamp; a discarded answer is no failure.
  let visible: boolean;
  let fallbackShown = false;
  if (fullKey === null) {
    visible = prefix !== null;
  } else {
    const stamped = isCurrentSWRValue(fullKey, raw);
    if (stamped !== undefined) {
      visible = stamped;
    } else if (keep && raw === lastShown.current) {
      visible = true;
    } else if (
      Object.is(raw, options?.fallbackData) ||
      Object.is(
        raw,
        (fallback as Record<string, unknown> | undefined)?.[fullKey],
      )
    ) {
      visible = isFallbackVisible(fullKey);
      fallbackShown = visible;
    } else {
      visible = isVisibleSWRValue(fullKey, raw);
    }
  }
  const fallbackGeneration = fullKey ? dataGenerationOf(fullKey) : 0;
  useLayoutEffect(() => {
    if (fallbackShown && fullKey)
      noteFallbackShown(fullKey, fallbackGeneration);
  }, [fallbackShown, fullKey, fallbackGeneration]);
  const data = visible ? raw : undefined;
  useLayoutEffect(() => {
    if (data !== undefined) lastShown.current = data;
  }, [data]);
  const errorVisible =
    !discarded && (fullKey === null || isCurrentSWRError(fullKey, rawError));
  const ownError = errorVisible ? rawError : undefined;
  const refusal = useSyncExternalStore(
    subscribeRefusals,
    () => (fullKey === null ? undefined : refusalFor(fullKey)),
    () => undefined,
  );
  const refused = refusal !== undefined || isReadRefusal(ownError);
  // SWR's own failure when it has one; the cache removal clears it, then
  // the refusal in force is the failure.
  const error = ownError ?? (refusal as E | undefined);

  const arrived = configured === true && !keep && data !== undefined;
  useLayoutEffect(() => {
    if (arrived) shown.current = { generation, moved };
  }, [arrived, generation, moved]);

  // Load again once per generation: after a discarded answer, or when the
  // shown data belongs to an older generation and no error explains it.
  const reload =
    fullKey === null
      ? null
      : discarded
        ? `request:${fullKey}:${requestGenerationOf(fullKey)}`
        : revalidateMissing && !visible && error === undefined
          ? `data:${fullKey}:${dataGenerationOf(fullKey)}`
          : null;
  const reloaded = useRef<string | null>(null);
  const revalidate = response.mutate;
  useEffect(() => {
    if (reload === null || reloaded.current === reload) return;
    reloaded.current = reload;
    void revalidate();
  }, [reload, revalidate]);

  const mutationGeneration = fullKey === null ? 0 : dataGenerationOf(fullKey);
  const mutate = useMemo(
    () => lockBoundMutate<T>(fullKey, cache, cacheMutate, mutationGeneration),
    [fullKey, cache, cacheMutate, mutationGeneration],
  );
  // The refused answer leaves the cache itself, so no cache read and no
  // later render can show it; the refusal stays in its own store.
  const withdraw = refused && raw !== undefined;
  useEffect(() => {
    if (!withdraw || fullKey === null) return;
    // The render that asked for this is over: a read may have succeeded
    // since. Only a refusal that still stands withdraws anything.
    const refusedNow =
      isReadRefusal(ownError) && cache.get(fullKey)?.error === ownError;
    if (!refusedNow && refusalFor(fullKey) === undefined) return;
    if (refusedNow) {
      // Counted here too: this effect can run before SWR calls onError, and
      // then the cache no longer holds the data that callback looks for. A
      // refusal already in force is not counted again when another view
      // writes the key: no shown data was refused then.
      noteShownDataRefusal();
      // SWR calls onError only for the hook that started the request and
      // still reads its key. A refusal known from the cache alone is
      // recorded here, before the removal clears that error.
      markRefused(fullKey, ownError);
    }
    void mutate(undefined, { revalidate: false });
    // `raw` too: a value another view writes under a refusal goes as well.
  }, [withdraw, raw, mutate, fullKey, ownError, refusal, cache]);
  return {
    data: refused ? undefined : data,
    error,
    mutate,
    readCurrent() {
      if (
        fullKey === null ||
        isSWRSessionPending() ||
        dataGenerationOf(fullKey) !== mutationGeneration
      )
        return { data: undefined, error: undefined };
      const current = cache.get(fullKey);
      const held = refusalFor(fullKey);
      return {
        data:
          held === undefined &&
          isCurrentSWRValue(fullKey, current?.data) === true
            ? (current?.data as T)
            : undefined,
        error: isCurrentSWRError(fullKey, current?.error)
          ? (current?.error as E)
          : (held as E | undefined),
      };
    },
    get isValidating() {
      return response.isValidating;
    },
    get isLoading() {
      return response.isLoading || (!visible && response.isValidating);
    },
  } as ScopedSWRResponse<T, E>;
}

/**
 * SWR hook with authentication and tenant cache isolation.
 *
 * Only fetches data while the session grants access (hasSessionAccess).
 * Cache keys are automatically prefixed with the session's scope (school and
 * account, see scope.ts), to prevent data from one session appearing in
 * another.
 *
 * @example
 * ```tsx
 * const { data, isLoading, error } = useSWRAuth(
 *   'students-list',
 *   () => fetchStudents()
 * );
 * ```
 *
 * @param key - Unique cache key for this data (use null to disable fetching)
 * @param fetcher - Async function that returns the data
 * @param options - Optional SWR configuration overrides
 */
export function useSWRAuth<T, E = Error>(
  key: string | null,
  fetcher: () => Promise<T>,
  options?: ReaderOptions<T, E>,
): ScopedSWRResponse<T, E> {
  // Fetches only while the session grants access (hasSessionAccess) and, in
  // the school portal, carries its school: swrScopePrefix is null otherwise.
  return useScopedSWR<T, E>(key, fetcher, options);
}

/** What `useOpeningRead` takes besides key and fetcher. */
export interface OpeningReadOptions<T> {
  /**
   * `true` for a form's snapshot: the cached answer shows at once and this
   * opening's read replaces it. `false` for a read the server logs or
   * authorizes on every opening: nothing shows until this opening's own
   * read answered.
   */
  readonly showCached: boolean;
  /** Holds the opening's read back while it returns true. */
  readonly isPaused?: () => boolean;
  /** Called with the answer of each read of this hook. */
  readonly onSuccess?: (data: T) => void;
  /** Called with the failure of each read of this hook. */
  readonly onError?: (error: unknown) => void;
}

/** One opening of a surface and the read it is filled on (ADR 0311). */
export interface OpeningRead<T> {
  /**
   * This opening's answer, held: a later read of another view does not
   * replace it. Before the answer: the cache with `showCached`, else
   * undefined. Undefined after a failed first read and while the server
   * refuses the read (401, 403).
   */
  readonly data: T | undefined;
  /**
   * The shared cache as it is now, possibly newer than `data` (another
   * view read the key since). Only for refilling an untouched form; never
   * decide or save against it. Undefined until the opening settled when
   * `showCached` is false.
   */
  readonly latest: T | undefined;
  /** This opening's own read answered, with data or a failure. */
  readonly settled: boolean;
  /** `key` is set and the opening has not settled. */
  readonly isLoading: boolean;
  /** The newest read of the key is under way (this hook's or an invalidation's). */
  readonly isValidating: boolean;
  /** The failure to show: a refusal in force or this opening's last failed read. */
  readonly error: unknown;
  /** Reads again; a failure shows in `error`, held data stays. */
  readonly retry: () => void;
  /**
   * Reads again and holds the answer (after a refused save). Rejects on
   * failure and leaves the opening as it was: SWR's own revalidation would
   * resolve with the old data instead.
   */
  readonly reload: () => Promise<T>;
  /**
   * SWR-shaped writer for callers that hand on a save's answer:
   * `mutate(answer, { revalidate: false })` writes the cache and holds the
   * answer, `mutate()` reads again like `retry`, `mutate(undefined, …)`
   * clears the cache entry.
   */
  readonly mutate: SWRResponse<T>["mutate"];
}

/**
 * The wrapper read of an opening. Focus, reconnect, mount and error retries
 * start nothing; an invalidation of the key reads again only while the
 * opening has started its own read (`isPaused` below).
 */
const OPENING_READER = {
  keepPreviousData: false,
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  revalidateOnMount: false,
  revalidateIfStale: false,
  shouldRetryOnError: false,
  dedupingInterval: 0,
} as const;

type OpeningFlight<T> =
  | { readonly ok: true; readonly flight: number; readonly data: T | undefined }
  | { readonly ok: false; readonly flight: number; readonly error: unknown };

interface OpeningSource<T> {
  readonly fullKey: string;
  readonly fetcher: () => Promise<T>;
  readonly mutate: SWRResponse<T>["mutate"];
  readonly shown: T | undefined;
  readonly onSuccess?: (data: T) => void;
  readonly onError?: (error: unknown) => void;
}

/**
 * One read of an opening through the shared cache and the generation lock,
 * with the refusal rules of a fetch: a 401/403 marks the key refused, a
 * success lifts it. An invalidation while the read runs ends its request
 * generation; that answer may predate a write, so it reads once more.
 */
async function readThrough<T>(
  current: OpeningSource<T>,
  flight: number,
): Promise<OpeningFlight<T>> {
  for (let tries = 0; ; tries += 1) {
    try {
      const data = await current.mutate(
        lockFetcher(current.fullKey, current.fetcher)(),
        { revalidate: false },
      );
      // Undefined: a scope or data bump dropped the run; the bump
      // started a new opening.
      if (data !== undefined) {
        liftRefusal(current.fullKey);
        current.onSuccess?.(data);
      }
      return { ok: true, flight, data };
    } catch (error) {
      if (isDiscardedAnswer(error) && tries < 2) continue;
      if (!isDiscardedAnswer(error)) {
        if (isAccessRefusal(error) && current.shown !== undefined) {
          noteShownDataRefusal();
        }
        if (isReadRefusal(error)) markRefused(current.fullKey, error);
        current.onError?.(error);
      }
      return { ok: false, flight, error };
    }
  }
}

/**
 * The one per-opening read (ADR 0311): a surface reads anew each time it
 * opens and holds that answer. An opening is the key under the session's
 * scope and the key's data generation; a `null` key closes it, the next
 * key or a bump starts a new one, also A → B → A. Every read goes through
 * the shared cache and the generation lock and keeps its refusal rules:
 * a 401/403 withdraws the data for every reader until a read succeeds.
 * Focus, reconnect, key changes and error retries start no read; an
 * invalidation of the key (a write, a live event) reads again once the
 * opening has started. With `showCached: false` the shown data follows
 * those reads; a form (`showCached: true`) keeps its answer and finds the
 * newer one in `latest`.
 *
 * Use it for a read the server logs or authorizes on every opening
 * (`showCached: false`). Edits and previews take `useReadDraft`
 * (`~/lib/swr/read-draft`), which is built on it.
 */
export function useOpeningRead<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  options: OpeningReadOptions<T>,
): OpeningRead<T> {
  const { prefix, generation } = useSWRScope();
  const fullKey =
    key !== null && prefix !== null ? scopedSWRKey(prefix, key) : null;
  // Renders again when a scope or data bump ends the opening.
  useSyncExternalStore(
    subscribeSWRDataGeneration,
    currentSWRDataGeneration,
    currentSWRDataGeneration,
  );
  const opening =
    fullKey === null
      ? null
      : JSON.stringify([fullKey, generation, dataGenerationOf(fullKey)]);
  // SWR starts automatic reads on a key change even with mount
  // revalidation off. Until this opening started its own read, none runs;
  // reset before SWR's own layout effects of the new key can read.
  const ready = useRef(false);
  useLayoutEffect(() => {
    ready.current = false;
  }, [opening]);
  const read = useScopedSWR<T, unknown>(
    key,
    fetcher,
    {
      ...OPENING_READER,
      isPaused: () => !ready.current,
      ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
      ...(options.onError ? { onError: options.onError } : {}),
    },
    swrConfig,
    false,
  );

  // A new serial per opening: A → B → A must not find A's first answer.
  const [track, setTrack] = useState({ opening, serial: 0 });
  let serial = track.serial;
  if (track.opening !== opening) {
    serial = track.serial + 1;
    setTrack({ opening, serial });
  }
  const [attempt, setAttempt] = useState({ serial, count: 0 });
  const count = attempt.serial === serial ? attempt.count : 0;
  const [held, setHeld] = useState<{
    serial: number;
    flight: number;
    data: T;
  }>();
  const [failed, setFailed] = useState<{
    serial: number;
    flight: number;
    error: unknown;
  }>();

  const flights = useRef(0);
  // The newest read of this hook while it runs; an older one it overtook
  // does not count.
  const [pending, setPending] = useState<number | null>(null);
  const latest = useRef({
    fullKey,
    fetcher,
    mutate: read.mutate,
    shown: read.data,
    serial,
    onSuccess: options.onSuccess,
    onError: options.onError,
  });
  // Committed renders only: an abandoned render must not steer the
  // still-visible opening's reads.
  useLayoutEffect(() => {
    latest.current = {
      fullKey,
      fetcher,
      mutate: read.mutate,
      shown: read.data,
      serial,
      onSuccess: options.onSuccess,
      onError: options.onError,
    };
  });

  const readOnce = useCallback(async (): Promise<OpeningFlight<T>> => {
    const current = latest.current;
    const flight = ++flights.current;
    const { fullKey: readKey } = current;
    if (readKey === null) {
      return { ok: false, flight, error: new DiscardedAnswer() };
    }
    setPending(flight);
    try {
      return await readThrough({ ...current, fullKey: readKey }, flight);
    } finally {
      setPending((newest) => (newest === flight ? null : newest));
    }
  }, []);

  const paused = options.isPaused?.() === true;
  const open = opening !== null;
  useEffect(() => {
    if (!open || paused) return;
    let current = true;
    ready.current = true;
    void readOnce().then((result) => {
      if (!current) return;
      if (!result.ok) {
        setFailed({ serial, flight: result.flight, error: result.error });
      } else if (result.data !== undefined) {
        setHeld({ serial, flight: result.flight, data: result.data });
      }
    });
    return () => {
      current = false;
      ready.current = false;
    };
  }, [serial, open, count, paused, readOnce]);

  const own = held?.serial === serial ? held : undefined;
  const failure =
    failed?.serial === serial &&
    (own === undefined || failed.flight > own.flight)
      ? failed
      : undefined;
  const refusal =
    read.error !== undefined && isReadRefusal(read.error)
      ? read.error
      : undefined;
  const settled = own !== undefined || failure !== undefined;
  const visible = options.showCached || settled;

  const retry = useCallback(() => {
    setAttempt({ serial: latest.current.serial, count: count + 1 });
  }, [count]);
  const reload = useCallback(async () => {
    const forSerial = latest.current.serial;
    const result = await readOnce();
    if (!result.ok) throw result.error;
    if (result.data === undefined) throw new DiscardedAnswer();
    const data = result.data;
    setHeld({ serial: forSerial, flight: result.flight, data });
    return data;
  }, [readOnce]);
  const mutate = useCallback(
    ((...args: unknown[]) => {
      const current = latest.current;
      if (args.length === 0) {
        return readOnce().then((result) => {
          if (!result.ok) {
            setFailed({
              serial: current.serial,
              flight: result.flight,
              error: result.error,
            });
            return undefined;
          }
          if (result.data !== undefined) {
            const data = result.data;
            setHeld({ serial: current.serial, flight: result.flight, data });
          }
          return result.data;
        });
      }
      const flight = ++flights.current;
      const written = (
        current.mutate as (...values: unknown[]) => Promise<T | undefined>
      )(...args);
      if (args[0] === undefined) return written;
      return written.then((data) => {
        if (data !== undefined) {
          setHeld({ serial: current.serial, flight, data });
        }
        return data;
      });
    }) as SWRResponse<T>["mutate"],
    [readOnce],
  );

  return {
    data:
      refusal !== undefined
        ? undefined
        : own
          ? options.showCached
            ? own.data
            : (read.data ?? own.data)
          : failure || !options.showCached
            ? undefined
            : read.data,
    latest: refusal !== undefined || !visible ? undefined : read.data,
    settled,
    isLoading: key !== null && !settled,
    isValidating: pending !== null || read.isValidating,
    error: refusal ?? failure?.error,
    retry,
    reload,
    mutate,
  };
}

/**
 * Reads a `useSWRAuth` key again and rejects when that read fails. SWR's
 * `mutate()` resolves with the old data instead, so a reload after a
 * refused write would claim the new state shows (ADR 0311, rule 6). For
 * `show(error, { reload })` and `useDraftOn`.
 */
export async function revalidateOrThrow<T>(
  read: Pick<ScopedSWRResponse<T, unknown>, "mutate" | "readCurrent">,
): Promise<T> {
  const answered = await read.mutate();
  const current = read.readCurrent?.();
  if (current?.error !== undefined) throw current.error;
  const data = current ? current.data : answered;
  // A scope or data bump dropped the read: nothing confirmed to show.
  if (data === undefined) throw new DiscardedAnswer();
  return data;
}

/**
 * The cache key useSWRAuth reads for `key` under the session's scope; null
 * while the session grants no access. For state the readers of one key
 * share, e.g. a single refresh for all of them.
 */
export function useScopedSWRKey(key: string): string | null {
  const { prefix } = useSWRScope();
  return prefix === null ? null : scopedSWRKey(prefix, key);
}

/**
 * SWR hook for immutable/static data that rarely changes.
 *
 * Disables automatic revalidation to minimize unnecessary requests.
 * Perfect for: roles, permissions, categories, configuration data.
 *
 * @example
 * ```tsx
 * const { data: roles } = useImmutableSWR(
 *   'roles',
 *   () => authService.getRoles()
 * );
 * ```
 *
 * @param key - Unique cache key for this data (use null to disable fetching)
 * @param fetcher - Async function that returns the data
 */
export function useImmutableSWR<T, E = Error>(
  key: string | null,
  fetcher: () => Promise<T>,
): SWRResponse<T, E> {
  return useScopedSWR<T, E>(key, fetcher, undefined, immutableConfig);
}

/**
 * Hook that returns a tenant-aware mutate function.
 *
 * SWR cache keys are prefixed with the session's scope by useSWRAuth, so
 * plain `mutate("my-key")` misses the cache. This hook returns a function
 * that applies the same prefix before calling SWR mutate. A function kept
 * from an earlier account or school only reaches that scope's keys: a late
 * write or rollback never lands in the cache of the session after it.
 * Without a signed-in session there is no scope and nothing to mutate.
 *
 * @example
 * ```tsx
 * const tenantMutate = useTenantMutate();
 * await tenantMutate(staffKeys.teachersKey());
 * ```
 */
export function useTenantMutate() {
  const { prefix } = useSWRScope();
  const origin = useDataOrigin();

  return useCallback(
    (
      key: string,
      data?: unknown,
      options?: MutatorOptions,
    ): Promise<unknown> => {
      if (prefix === null || isSWRSessionPending())
        return Promise.resolve(undefined);
      const cacheKey = scopedSWRKey(prefix, key);
      // A retained action or passive effect must not restamp captured data
      // after a layout-effect reset. Only this key's data bumps count, so
      // an unrelated drop (including `except`) leaves the callback usable.
      if (dataGenerationOf(cacheKey) > origin.generation)
        return Promise.resolve(undefined);
      if (data === undefined) {
        return currentResult(cacheKey, swrMutate(cacheKey));
      }
      // A write that settles after the generation moved is not kept.
      const [locked, lockedOptions, run] = lockMutation(
        cacheKey,
        data,
        mutationOptions(options),
      );
      return runResult(
        run,
        swrMutate(cacheKey, locked, lockedOptions as never),
      );
    },
    [prefix, origin],
  );
}

/**
 * The generation a callback of this render originates in (G21), renewed only
 * when values stop counting (scope or data bump). A request bump moves the
 * generation counter but ends no value, so it keeps the object and with it
 * the identity of every callback built on it (#5223). The callbacks take any
 * key: a data bump of any key renews them, a retained one keeps its origin.
 */
function useDataOrigin(): { readonly generation: number } {
  const moved = useSyncExternalStore(
    subscribeSWRDataGeneration,
    currentSWRDataGeneration,
    currentSWRDataGeneration,
  );
  return useMemo(
    () => ({ moved, generation: currentSWRGeneration() }),
    [moved],
  );
}

/**
 * Hook that invalidates every tenant-scoped SWR cache entry whose key matches
 * a substring. Useful for cross-cutting changes that affect data displayed by
 * multiple unrelated pages — e.g. updating a room's color must refresh every
 * visit/student list that stamps `current_room_color` into its rows.
 *
 * Only keys of the session's scope (school and account) take part; caches
 * of another school or account (multi-tab) stay put, and without a
 * signed-in session nothing matches. Substrings should include enough
 * context to avoid over-invalidation. Pass an array of
 * substrings to match if any of them appears.
 *
 * **Picking substrings**: prefer fragments that are unlikely to collide with
 * future cache keys. `"ogs-students"` is safer than `"students"` because the
 * latter would also match `students-search`, `students-import`, etc., once
 * those caches exist. Substring match is a forward-compatibility hazard — a
 * new SWR consumer added later may accidentally land in your invalidation
 * net without anyone noticing. Err on the side of longer, more specific
 * fragments and revisit this list whenever a new cache key is introduced
 * that contains one of your substrings.
 *
 * **Convention**: existing SWR keys in this codebase put a trailing dash
 * before their first dynamic segment (`ogs-students-${groupId}`,
 * `active-supervision-dashboard-${refreshKey}`). Including that trailing
 * dash in your substring (`"ogs-students-"` instead of `"ogs-students"`)
 * narrows the match window and makes accidental collisions with future
 * keys that only happen to start with the same prefix less likely.
 *
 * **Stability**: Callers can pass a literal array each render — the hook
 * derives a stable string key internally from the joined substrings, so the
 * returned callback identity stays referentially stable across renders.
 * This avoids cascading useCallback invalidations in consumers that depend
 * on the returned function.
 *
 * **What is touched**: every place SWR keeps a matching key
 * (invalidateSWRKeys): cache entries also without a mounted reader,
 * `$inf$`/`$sub$` entries, requests in flight and inside the dedupe window,
 * preloads and mutations (#5006). A plain call revalidates: mounted readers
 * load again, keep their data until the answer, and no later reader reuses a
 * request or preload from before.
 *
 * **Clearing instead of revalidating**: pass `{ clear: true }` to DELETE the
 * matching entries without refetching. Data, error and loading state go,
 * requests and mutations in flight write nothing back, and data kept on
 * screen goes too — for consumers that must never act on pre-mutation data.
 * The next mount loads fresh with `isLoading: true`.
 *
 * **Leaving keys out**: `except` names unprefixed keys that are not touched
 * in any of these places, e.g. the list a decision was just made in, which
 * already shows its result (#4988).
 *
 * @example
 * ```tsx
 * const refreshRoomConsumers = useTenantMutateMatching([
 *   "active-supervision",
 *   "supervision-visits",
 *   "ogs-students",
 *   "search-students",
 * ]);
 * await refreshRoomConsumers(); // every cache key containing one of those substrings refetches
 * ```
 */
export function useTenantMutateMatching(substrings: readonly string[]) {
  const { prefix } = useSWRScope();
  const { cache } = useSWRConfig();
  // "|" is a safe joiner: substrings are caller-supplied cache-key fragments
  // (literals like "ogs-students"), which cannot legally contain pipe in any
  // SWR key the codebase produces. The joined string is the actual dep — a
  // fresh array literal with identical contents reuses the memoized callback.
  const joined = substrings.join("|");

  return useCallback(
    (options?: { clear?: boolean; except?: readonly string[] }) => {
      if (prefix === null || isSWRSessionPending()) return Promise.resolve([]);
      const needles = joined.length > 0 ? joined.split("|") : [];
      const kept = new Set(
        (options?.except ?? []).map((key) => scopedSWRKey(prefix, key)),
      );
      const scope = scopedSWRKey(prefix, "");
      // Every place SWR keeps a matching key, not only entries a mounted
      // hook keyed (#5006): a request or preload from before the change
      // must not answer the next reader. `except` keys stay untouched.
      return invalidateSWRKeys(
        cache,
        (key) =>
          !kept.has(key) &&
          key.startsWith(scope) &&
          needles.some((needle) => key.includes(needle)),
        options?.clear ? "clear" : "revalidate",
      );
    },
    [prefix, joined, cache],
  );
}

/**
 * Returns a function that drops every cache entry of one child or other
 * entity after the server refused it (401, 403, 404 with one of `codes`), so
 * no view keeps showing it: e.g. a guardian whose access to a child ended.
 * `matches` gets each unscoped key of the session's scope. Entries keep
 * their error and are not fetched again; data kept on screen goes too.
 * Returns whether the error was such a refusal.
 *
 * @example
 * ```tsx
 * const discard = useDiscardRefusedEntity();
 * if (discard(error, {
 *   codes: ["general.not_found", "general.permission"],
 *   matches: (key) => key.includes(`student-${studentId}`),
 * })) return <LoadErrorAlert … />;
 * ```
 */
export function useDiscardRefusedEntity() {
  const { prefix } = useSWRScope();
  const { cache } = useSWRConfig();

  return useCallback(
    (
      error: unknown,
      entity: {
        codes: readonly ErrorCode[];
        matches: (key: string) => boolean;
        /** The refused request's key, when its error did not pass through SWR. */
        refusedKey?: string;
      },
    ): boolean => {
      if (!isEntityRefusal(error, entity.codes)) return false;
      if (prefix !== null) {
        discardScopedEntries(
          cache,
          prefix,
          entity.matches,
          error,
          entity.refusedKey,
        );
      }
      return true;
    },
    [prefix, cache],
  );
}

/**
 * Call the hook in the component; call its returned starter inside the SWR
 * fetcher before awaiting. Its completion callback runs synchronous effects
 * only in that request's scope and generation, even after a key change.
 * Stale completions become the wrapper's silent DiscardedAnswer. This exposes
 * no cache or writer, and does not change SWR's view-bound onSuccess contract.
 */
export function useSWRRequestGuard() {
  const { prefix } = useSWRScope();
  const origin = currentSWRGeneration();
  const latestPrefix = useRef(prefix);
  useLayoutEffect(() => {
    latestPrefix.current = prefix;
  }, [prefix]);
  return useCallback(
    (key: string | null) => {
      if (
        prefix === null ||
        key === null ||
        isSWRSessionPending() ||
        latestPrefix.current !== prefix
      )
        throw new DiscardedAnswer();
      const fullKey = scopedSWRKey(prefix, key);
      if (dataGenerationOf(fullKey) > origin) throw new DiscardedAnswer();
      const started = startOf(fullKey);
      const isCurrent = () =>
        !isSWRSessionPending() &&
        latestPrefix.current === prefix &&
        isStillCurrent(fullKey, started);
      return Object.assign(
        (complete: () => void): void => {
          if (!isCurrent()) throw new DiscardedAnswer();
          complete();
        },
        { isCurrent },
      );
    },
    [prefix, origin],
  );
}

/** Resolve a factory key for cache reads/seeds without duplicating session scoping. */
export function useSWRCacheKey() {
  const { prefix } = useSWRScope();
  return useCallback(
    (key: string) => (prefix === null ? null : scopedSWRKey(prefix, key)),
    [prefix],
  );
}

/** Hover/intent preload, held to the same session and generation as mounted readers. */
export function useSWRPreload() {
  const { prefix } = useSWRScope();
  const { cache } = useSWRConfig();
  const origin = useDataOrigin();
  return useCallback(
    <T>(
      key: string,
      fetcher: () => Promise<T>,
      options?: { intent: true },
    ): Promise<T | undefined> => {
      if (prefix === null || isSWRSessionPending())
        return Promise.resolve(undefined);
      const fullKey = scopedSWRKey(prefix, key);
      if (dataGenerationOf(fullKey) > origin.generation)
        return Promise.resolve(undefined);
      const entry = cache.get(fullKey);
      // A mounted reader already owns this request; never start a parallel
      // speculative copy while its answer is still missing.
      if (options?.intent && entry?.isValidating)
        return Promise.resolve(undefined);
      const cached = entry?.data as T | undefined;
      if (
        options?.intent &&
        cached !== undefined &&
        isCurrentSWRValue(fullKey, cached) === true
      )
        return Promise.resolve(undefined);
      const start = startOf(fullKey);
      return preloadSWR(
        fullKey,
        async () => {
          // The consumed-intent fallback must obey the original request's
          // generation and the live session gate, just like the first load.
          if (isSWRSessionPending() || !isStillCurrent(fullKey, start))
            throw new DiscardedAnswer();
          return fetcher();
        },
        options?.intent,
      ).then(
        (value) =>
          isStillCurrent(fullKey, start) && isVisibleSWRValue(fullKey, value)
            ? value
            : undefined,
        (error: unknown) => {
          if (
            isDiscardedAnswer(error) ||
            !isStillCurrent(fullKey, start) ||
            !isCurrentSWRError(fullKey, error)
          )
            return undefined;
          throw error;
        },
      );
    },
    [prefix, origin, cache],
  );
}

/**
 * Invalidate every entry of the session's scope whose resource key `matches`,
 * wherever SWR keeps it (invalidateSWRKeys). `matches` gets the key without
 * the scope prefix, as the factories build it; `() => true` refreshes every
 * entry of the session. The predicate form of useTenantMutateMatching: the
 * cache of another school or account is never touched, and without a
 * signed-in session nothing matches. Components outside ~/lib/swr have no
 * other access to the cache (#5007).
 */
export function useInvalidateMatching() {
  const { prefix } = useSWRScope();
  const { cache } = useSWRConfig();
  return useCallback(
    (matches: (key: string) => boolean, options?: { clear?: boolean }) => {
      if (prefix === null || isSWRSessionPending()) return Promise.resolve([]);
      const scope = scopedSWRKey(prefix, "");
      return invalidateSWRKeys(
        cache,
        (key) => key.startsWith(scope) && matches(key.slice(scope.length)),
        options?.clear ? "clear" : "revalidate",
      );
    },
    [prefix, cache],
  );
}

/** Invalidate a resource family, including unmounted, infinite and preloaded keys. */
export function useInvalidateFamily() {
  const { prefix } = useSWRScope();
  const { cache } = useSWRConfig();
  return useCallback(
    (family: string, options?: { clear?: boolean }) => {
      if (prefix === null || isSWRSessionPending()) return Promise.resolve([]);
      const start = scopedSWRKey(prefix, family);
      return invalidateSWRKeys(
        cache,
        (key) => key.startsWith(start),
        options?.clear ? "clear" : "revalidate",
      );
    },
    [prefix, cache],
  );
}
