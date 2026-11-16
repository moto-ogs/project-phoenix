"use client";

import { useSession } from "next-auth/react";
import { metadataLoadError } from "./metadata-load-error";
import {
  useConfirmedResource,
  useRefusalGuard,
} from "./use-traeger-confirmed-resource";
import { type ReaderOptions, useSWRAuth } from "~/lib/swr";

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
  options?: Omit<ReaderOptions<T>, "onSuccess" | "onError">,
) {
  const { data: session } = useSession();
  const scoped = session?.user.scope === "org" ? key : null;
  const guard = useRefusalGuard(scoped);
  const response = useSWRAuth(scoped, fetcher, {
    keepPreviousData: false,
    ...options,
    ...guard.callbacks,
  });
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
  };
}
