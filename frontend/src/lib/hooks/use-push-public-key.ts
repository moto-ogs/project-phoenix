"use client";

import { useMemo } from "react";
import {
  fetchPushPublicKey,
  pushConfigurationMissing,
  type PushPortal,
  type PushPublicKey,
} from "~/lib/push-api";
import { useSWRAuth } from "~/lib/swr";
import { shellResourceKeys } from "~/lib/swr/shell-keys";

/**
 * The portal's Web Push key, read once for every reader of the page: the
 * session sync in the providers, the guided setup in the shell and the
 * settings card. A server without Web Push answers `missing`; that answer is
 * kept like a key and not asked for again.
 */
export interface PushPublicKeyRead {
  readonly state: "loading" | "missing" | "failed" | "ready";
  /** The key, or the failure a push action reports without one. */
  readonly require: () => PushPublicKey;
  /** For a click: the key at hand, else one new read of it. */
  readonly load: () => Promise<PushPublicKey>;
}

export function usePushPublicKey(portal: PushPortal): PushPublicKeyRead {
  // An object, also for "no key": the cache keeps an answer it can mark as
  // this session's, and a bare null carries no such mark.
  const {
    data: answer,
    error,
    mutate,
  } = useSWRAuth<{ readonly key: PushPublicKey | null }, unknown>(
    shellResourceKeys.pushPublicKey(portal),
    async () => ({ key: await fetchPushPublicKey(portal) }),
    {
      // The key changes with a server deployment, not within a tab.
      // Failed reads still use the shared bounded retries.
      revalidateIfStale: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
  return useMemo(() => {
    const data = answer?.key;
    const state =
      answer === undefined
        ? error === undefined
          ? "loading"
          : "failed"
        : data
          ? "ready"
          : "missing";
    return {
      state,
      require: () => {
        if (data) return data;
        throw state === "failed" ? error : pushConfigurationMissing();
      },
      load: async () => {
        if (data) return data;
        const fresh = await mutate(
          fetchPushPublicKey(portal).then((key) => ({ key })),
          { revalidate: false },
        );
        if (!fresh?.key) throw pushConfigurationMissing();
        return fresh.key;
      },
    };
  }, [answer, error, mutate, portal]);
}
