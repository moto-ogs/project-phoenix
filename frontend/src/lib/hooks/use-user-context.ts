"use client";

import { bffJson } from "~/lib/bff-fetch";
import { useImmutableSWR } from "~/lib/swr";
import { shellResourceKeys } from "~/lib/swr/shell-keys";
import { mapUserContext } from "~/lib/user-context-map";

export const USER_CONTEXT_SWR_KEY = shellResourceKeys.userContext();

/** Staff profile and school switches, shared with the tenant shell seed. */
export function useUserContext(enabled = true) {
  const { data, isLoading, error } = useImmutableSWR(
    enabled ? USER_CONTEXT_SWR_KEY : null,
    async () =>
      mapUserContext(await bffJson("tenant", "GET /api/me/navigation")),
  );

  return {
    userContext: data,
    isLoading,
    error,
    isReady: data !== undefined || error !== undefined,
  };
}

/**
 * No profile is different from a failed/unconfirmed read. In the latter case
 * the page's existing permission and error paths continue to decide (#7306).
 */
export function useHasOwnStaff(enabled = true): boolean {
  return useUserContext(enabled).userContext?.currentStaff !== null;
}
