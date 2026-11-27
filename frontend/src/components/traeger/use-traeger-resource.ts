"use client";

import { useSession } from "next-auth/react";
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
} from "~/lib/swr";
import { useSWRRequestGuard } from "~/lib/swr/hooks";
import { useLatest } from "~/lib/hooks/use-latest";

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
  options?: Pick<TraegerReaderOptions<T>, "isPaused">,
) {
  const { scoped, guard } = useTraegerScope(key);
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
 * Later pages and downloads share the list's access boundary. Discard
 * superseded answers and keep any refusal scoped to the list that asked.
 */
export function useTraegerListRequest(key: string, clearCurrent: () => void) {
  const guard = useRefusalGuard(key);
  const begin = useSWRRequestGuard();
  const invalidate = useInvalidateMatching();
  const currentKey = useLatest(key);

  return async function request<T>(
    fetch: () => Promise<T>,
  ): Promise<T | undefined> {
    let complete;
    try {
      complete = begin(key);
      const result = await fetch();
      if (complete.isCurrent()) return result;
    } catch (error) {
      if (!complete?.isCurrent()) return;
      if (isRefusal(error)) {
        complete(() => {
          guard.callbacks.onError(error);
          if (currentKey.current === key) {
            clearCurrent();
          }
          void invalidate((cached) => cached === key, { clear: true });
        });
      }
      throw error;
    }
  };
}

/** The key only for a Träger session, with its refusal guard. */
function useTraegerScope(key: string | null) {
  const { data: session } = useSession();
  const scoped = session?.user.scope === "org" ? key : null;
  const guard = useRefusalGuard(scoped);
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
