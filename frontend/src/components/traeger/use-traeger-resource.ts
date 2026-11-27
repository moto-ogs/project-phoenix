"use client";

import { useSession } from "next-auth/react";
import {
  isAccessRefusal,
  markRefused,
  noteShownDataRefusal,
  refusalFor,
} from "~/lib/access-refusal";
import { metadataLoadError } from "./metadata-load-error";
import {
  isRefusal,
  type RefusalGuard,
  useConfirmedResource,
  useRefusalGuard,
} from "./use-traeger-confirmed-resource";
import {
  type ReaderOptions,
  type SWRResponse,
  revalidateOrThrow,
  useOpeningRead,
  useInvalidateMatching,
  useSWRAuth,
  useSWRCacheKey,
} from "~/lib/swr";
import { isDiscardedAnswer, useSWRRequestGuard } from "~/lib/swr/hooks";

type TraegerReaderOptions<T> = Omit<ReaderOptions<T>, "onSuccess" | "onError">;

/**
 * The one way a Träger page or card reads: shared between pages under its
 * key of `~/lib/swr`, only for a Träger session, with the refusal rules of
 * `useConfirmedResource`. `key` null reads nothing (a missing id, a closed
 * dialog). `object` names what failed to load, in the accusative
 * („die Liste der Verträge“).
 *
 * After a write, hand the answer to `mutate(next, { revalidate: false })` or
 * call `reload()`; other keys the write changed go through
 * `useInvalidateFamily`.
 */
export function useTraegerResource<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  object: string,
  options?: TraegerReaderOptions<T>,
) {
  const { scoped, guard } = useTraegerScope(key);
  const response = useSWRAuth(scoped, fetcher, {
    keepPreviousData: false,
    ...options,
    ...guard.callbacks,
  });
  return {
    ...useTraegerResult(scoped, response, guard, object),
    /**
     * Reads again and rejects when the read fails (ADR 0311, rule 6): for
     * `show(error, { reload })` and the drafts of `~/lib/swr/read-draft`.
     * `reload` and `mutate()` resolve with the old data instead.
     */
    reloadOrThrow: () => revalidateOrThrow(response),
  };
}

/**
 * `useTraegerResource` for a read the server logs or authorizes on every
 * opening (`useOpeningRead`, `showCached: false`): person data that stands
 * in the schools' access logs. `data` stays null until this opening's own
 * request answered. Focus, reconnect and key changes read nothing; an
 * invalidation of the key reads again (one more access-log entry) and its
 * answer replaces `data`, so a write invalidates the key only when it
 * changed what the card shows. `reload()` reads again.
 */
export function useFreshTraegerResource<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  object: string,
  options?: Pick<TraegerReaderOptions<T>, "isPaused"> & {
    readonly refusalKey?: string;
  },
) {
  const { scoped, guard } = useTraegerScope(key, options?.refusalKey);
  const opened = useOpeningRead(scoped, fetcher, {
    showCached: false,
    isPaused: options?.isPaused,
    ...guard.callbacks,
  });
  const response = {
    data: opened.data,
    error: opened.error,
    mutate: opened.mutate,
  };
  return {
    ...useTraegerResult(scoped, response, guard, object),
    /** Reads again and rejects when the read fails (ADR 0311, rule 6). */
    reloadOrThrow: opened.reload,
  };
}

/**
 * First pages, later pages and downloads share one permission across filters.
 * The family itself is not a data key: ordinary list refreshes only invalidate
 * the concrete keys, while a refusal also ends requests under the family key.
 */
export function useTraegerListRequest(
  family: string,
  hasShownRows: () => boolean,
) {
  const { data: session } = useSession();
  const key = session?.user.scope === "org" ? family : null;
  const cacheKey = useSWRCacheKey();
  const scoped = key === null ? null : cacheKey(key);
  const begin = useSWRRequestGuard();
  const invalidate = useInvalidateMatching();

  async function run<T>(
    fetch: () => Promise<T>,
    dataKey = key,
    onRefusal?: (error: unknown) => void,
  ) {
    const complete = begin(key);
    const completeData = dataKey === key ? complete : begin(dataKey);
    let result: T;
    try {
      result = await fetch();
    } catch (error) {
      if (!isRefusal(error)) {
        completeData(() => undefined);
        throw error;
      }
      // Record refusals before the opening read can discard an old sort's
      // answer. A second denial must not keep reopening the cleared list.
      complete(() => {
        onRefusal?.(error);
        if (scoped === null || refusalFor(scoped) !== undefined) return;
        if (isAccessRefusal(error) && hasShownRows()) noteShownDataRefusal();
        markRefused(scoped, error);
        void invalidate((cached) => cached.startsWith(family), { clear: true });
      });
      throw error;
    }
    completeData(() => undefined);
    return { result, isCurrent: completeData.isCurrent };
  }

  async function request<T>(fetch: () => Promise<T>, dataKey?: string) {
    try {
      return await run(fetch, dataKey);
    } catch (error) {
      if (!isDiscardedAnswer(error)) throw error;
    }
  }

  return {
    read: async <T>(
      fetch: () => Promise<T>,
      onRefusal?: (error: unknown) => void,
    ) => (await run(fetch, key, onRefusal)).result,
    request,
  };
}

/** The key only for a Träger session, with its refusal guard. */
function useTraegerScope(key: string | null, refusalKey?: string) {
  const { data: session } = useSession();
  const scoped = session?.user.scope === "org" ? key : null;
  const guard = useRefusalGuard(
    scoped === null ? null : (refusalKey ?? scoped),
  );
  return { scoped, guard };
}

function useTraegerResult<T>(
  scoped: string | null,
  response: Pick<SWRResponse<T>, "data" | "error" | "mutate">,
  guard: RefusalGuard,
  object: string,
) {
  const resource = useConfirmedResource(response, guard, object);
  const error = metadataLoadError(
    resource.loadError,
    resource.data !== null,
    resource.failure,
  );
  return {
    data: resource.data,
    /** Nothing to show yet and no failure: the first answer is on its way. */
    loading: scoped !== null && resource.data === null && !error,
    /** For `TenantPage error` or `LoadErrorAlert`; keeps loaded content on a transient failure. */
    error,
    failure: resource.failure,
    refused: resource.refused,
    reload: resource.reload,
    mutate: response.mutate,
    readCallbacks: guard.callbacks,
  };
}
