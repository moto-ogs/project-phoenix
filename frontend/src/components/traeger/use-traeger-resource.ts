"use client";

import { useSession } from "next-auth/react";
import { metadataLoadError } from "./metadata-load-error";
import {
  type RefusalGuard,
  useConfirmedResource,
  useRefusalGuard,
} from "./use-traeger-confirmed-resource";
import {
  type ReaderOptions,
  type SWRResponse,
  useOpeningRead,
  useSWRAuth,
} from "~/lib/swr";

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
  return useTraegerResult(scoped, response, guard, object);
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
  return useTraegerResult(scoped, response, guard, object);
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
