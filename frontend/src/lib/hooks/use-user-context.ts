/**
 * User Context Hook
 *
 * Provides shared user context data (educational groups, supervised groups, staff)
 * with SWR caching for automatic deduplication across pages.
 *
 * This hook uses useImmutableSWR because user context rarely changes during a session.
 * The 5-minute cache means navigating between pages won't trigger new API calls.
 *
 * @example
 * ```tsx
 * const { userContext, isLoading, error } = useUserContext();
 *
 * // Pre-computed arrays for components
 * const myGroupIds = userContext?.educationalGroupIds ?? [];
 * const myGroupRooms = userContext?.educationalGroupRoomNames ?? [];
 * ```
 */

"use client";

import { apiErrorFromResponse } from "~/lib/api-error";
import type { CallerNavigationRow } from "~/lib/contract/me.generated";
import { useImmutableSWR } from "~/lib/swr";
import { shellResourceKeys } from "~/lib/swr/shell-keys";
import { mapUserContext } from "~/lib/user-context-map";
import type { UserContextResponse } from "~/lib/user-context-types";

export class IncompleteUserContextError extends Error {
  constructor(readonly userContext: UserContextResponse) {
    super("User context fetch returned incomplete data");
  }
}

interface UseUserContextReturn {
  /** The user context data, undefined while loading */
  userContext: UserContextResponse | undefined;
  /** True while the initial fetch is in progress */
  isLoading: boolean;
  /** Error object if the fetch failed */
  error: Error | undefined;
  /** True when one or more optional navigation sections are unavailable */
  isIncomplete: boolean;
  /** Navigation sections unavailable in the current response */
  unavailableSections: string[];
  /** True once data has been fetched (even if empty) */
  isReady: boolean;
}

/**
 * Fetches the navigation context through the portal's catalog proxy
 * (GET /api/me/navigation, #7563), maps it once and caches it.
 *
 * Features:
 * - Automatic request deduplication (SWR)
 * - 5-minute cache for navigation performance
 * - React Strict Mode safe (no double-fetch)
 * - Pre-computed derived data (group IDs, room names)
 */
export const USER_CONTEXT_SWR_KEY = shellResourceKeys.userContext();

export function useUserContext(enabled = true): UseUserContextReturn {
  const { data, isLoading, error } = useImmutableSWR<UserContextResponse>(
    enabled ? shellResourceKeys.userContext() : null,
    async () => {
      const response = await fetch("/api/me/navigation", {
        credentials: "include",
      });

      if (!response.ok) {
        throw await apiErrorFromResponse(
          response,
          `User context fetch failed: ${response.status}`,
        );
      }

      const json = (await response.json()) as { data: CallerNavigationRow };
      const userContext = mapUserContext(json.data);
      if (userContext.incomplete) {
        throw new IncompleteUserContextError(userContext);
      }
      return userContext;
    },
  );

  const incompleteContext =
    error instanceof IncompleteUserContextError ? error.userContext : undefined;
  const userContext = incompleteContext ?? data;

  return {
    userContext,
    isLoading,
    error,
    isIncomplete: userContext?.incomplete === true,
    unavailableSections: userContext?.unavailableSections ?? [],
    isReady: data !== undefined || error !== undefined,
  };
}

/**
 * Hat die Person in dieser Schule ein Personalprofil? `false` nur, wenn der
 * Kontext vollständig geladen ist und kein Profil nennt, etwa für eine Person
 * des Trägers oder eine Schul-Admin ohne Profil (#7306). Solange er lädt,
 * fehlt oder unvollständig ist, gilt `true`: dann entscheidet wie bisher die
 * Seite.
 */
export function useHasOwnStaff(): boolean {
  const { userContext, isIncomplete } = useUserContext();
  return !(
    userContext !== undefined &&
    !isIncomplete &&
    userContext.currentStaff === null
  );
}
