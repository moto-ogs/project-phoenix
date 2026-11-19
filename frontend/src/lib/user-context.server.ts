import { contractGet } from "~/lib/contract/client.server";
import { routes } from "~/lib/contract/me.generated";
import { mapUserContext } from "~/lib/user-context-map";
import type { UserContextResponse } from "~/lib/user-context-types";

const NAVIGATION = routes["GET /api/me/navigation"];

/**
 * Loads the navigation projection (GET /api/me/navigation) for the
 * server-side shell bootstrap (#2973), checks it against the contract and
 * maps it like the browser does (#7563).
 *
 * Temporary (#7563): the route file app/api/user-context also answers with
 * this for app bundles built before #7563. After the next production deploy
 * only the shell bootstrap uses it.
 */
export async function loadUserContext(
  token: string,
  options?: { signal?: AbortSignal },
): Promise<UserContextResponse> {
  const result = await contractGet(
    `${NAVIGATION.method} ${NAVIGATION.pattern}`,
    NAVIGATION.response,
    "/api/me/navigation",
    token,
    options,
  );
  if (!result.ok) throw result.error.cause;
  return mapUserContext(result.value.data);
}
