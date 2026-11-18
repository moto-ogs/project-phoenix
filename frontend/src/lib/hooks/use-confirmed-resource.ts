"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import {
  isRefusal,
  refusalFor,
  subscribeRefusals,
  markRefused,
  liftRefusal,
} from "~/lib/access-refusal";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import {
  useSWRCacheKey,
  useSWRAuth,
  type SWRResponse,
  type ReaderOptions,
} from "~/lib/swr";

export { isRefusal };

/*
 * The one implementation of what every Träger read shows after a failure
 * (#4676). A hook builds its key in ~/lib/swr, then:
 *
 *   const key = session ? traegerKeys.x() : null;
 *   const guard = useRefusalGuard(key);
 *   const response = useSWRAuth(key, fetcher, { ...options, ...guard.callbacks });
 *   const x = useConfirmedResource(response, guard, "die …");
 *
 * Invariants:
 * 1. A refusal (401, 403, 404) removes the key's data from the SWR cache,
 *    not only from the screen, so no other reader of the key and no later
 *    render shows it.
 * 2. After a refusal, data shows again only after a successful fetch. A later
 *    5xx or network failure never brings refused data back, and neither does
 *    another view writing the old answer into the cache; the refusal stays the
 *    shown failure until then.
 * 3. A transient failure without an earlier refusal keeps confirmed data;
 *    `failure` is set, so the view shows a hint with „Wiederholen“.
 * 4. A refusal holds per SWR key for the whole tab, not per hook instance:
 *    while a key is refused, no reader of it hands out data, also when the
 *    cache is filled again. Only a successful fetch of the key lifts it.
 *    Logout and an account switch (resetSWRScope) lift every refusal.
 */

/** The refusal in force for one key, cleared only by a successful fetch. */
export interface RefusalGuard {
  readonly key: string | null;
  readonly refusal: unknown;
  /** Pass to the reader: they record refusals and successes of the fetch. */
  readonly callbacks: {
    readonly onSuccess: () => void;
    readonly onError: (error: unknown) => void;
  };
}

export function useRefusalGuard(resourceKey: string | null): RefusalGuard {
  const cacheKey = useSWRCacheKey();
  const key = resourceKey === null ? null : cacheKey(resourceKey);
  // SWR's own error is cleared by the cache removal and replaced by any later
  // failure, so the refusal lives in the tab-wide store, per key (invariant 4).
  const refusal = useSyncExternalStore(
    subscribeRefusals,
    () => (key === null ? undefined : refusalFor(key)),
    () => undefined,
  );
  const callbacks = useMemo(
    () => ({
      onSuccess: () => {
        if (key !== null) liftRefusal(key);
      },
      onError: (error: unknown) => {
        if (key !== null && isRefusal(error)) markRefused(key, error);
      },
    }),
    [key],
  );
  return { key, refusal, callbacks };
}

export interface ConfirmedResource<T> {
  /** Confirmed data, never data a refusal withdrew. */
  readonly data: T | null;
  /** The failure to show: the refusal in force, else SWR's error. */
  readonly failure: unknown;
  /** The failure as the error card of the load path, with retry. */
  readonly loadError: ReturnType<typeof useSwrLoadError>;
  /** A refusal is in force: no data until a fetch succeeds. */
  readonly refused: boolean;
  readonly reload: () => void;
}

export function useConfirmedResource<T>(
  response: Pick<SWRResponse<T>, "data" | "error" | "mutate">,
  guard: RefusalGuard,
  object: string,
): ConfirmedResource<T> {
  const resource = useRefusalSafeData(response, guard);
  const loadError = useSwrLoadError(resource.failure, object, response.mutate);
  return { ...resource, loadError };
}

function useRefusalSafeData<T>(
  response: Pick<SWRResponse<T>, "data" | "error" | "mutate">,
  guard: RefusalGuard,
) {
  const { mutate } = response;
  const refusedNow = isRefusal(response.error);
  const refused = refusedNow || guard.refusal !== undefined;
  const cached = response.data !== undefined;

  // Invariant 1: drop the refused answer from the cache itself.
  useEffect(() => {
    if (refused && cached) void mutate(undefined, { revalidate: false });
  }, [refused, cached, mutate]);

  // Invariant 2: while a refusal is in force it stays the shown failure.
  const failure = refusedNow
    ? response.error
    : refused
      ? guard.refusal
      : response.error;
  const reload = useCallback(() => void mutate(), [mutate]);

  return {
    data: refused ? null : (response.data ?? null),
    failure,
    refused,
    reload,
  };
}

/** Shared read whose refused data stays gone until an authorized read succeeds. */
export function useConfirmedSWR<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  options?: ReaderOptions<T>,
) {
  const guard = useRefusalGuard(key);
  const response = useSWRAuth(key, fetcher, {
    ...options,
    keepPreviousData: false,
    onSuccess: (data) => {
      guard.callbacks.onSuccess();
      options?.onSuccess?.(data);
    },
    onError: (error) => {
      guard.callbacks.onError(error);
      options?.onError?.(error);
    },
  });
  const resource = useRefusalSafeData(response, guard);
  return {
    ...resource,
    mutate: response.mutate,
    readCallbacks: guard.callbacks,
  };
}
