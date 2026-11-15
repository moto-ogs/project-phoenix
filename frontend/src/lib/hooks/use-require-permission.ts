"use client";

import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { useSession } from "next-auth/react";
import { hasPermission, isAdmin } from "~/lib/auth-utils";
import { useTenantAwarePath } from "~/lib/tenant-path";

interface UseRequirePermissionReturn {
  /** True once the session is loaded AND the user holds the permission (or is admin). Render gated content only when this is true. */
  readonly isReady: boolean;
  /** True while the session is still loading. Useful for showing a spinner instead of a flash of empty page. */
  readonly isLoading: boolean;
  /**
   * True once the session is loaded and the permission is missing. Only
   * reachable with `redirectWhenDenied: false`; otherwise the hook redirects.
   */
  readonly isDenied: boolean;
}

interface UseRequirePermissionOptions {
  /**
   * Redirect a caller without the permission to the home page (default). A
   * page that a link from outside opens, such as a notification's deep link
   * (#7148), passes false and explains the missing access itself instead of
   * dropping the person on another page without a word.
   */
  readonly redirectWhenDenied?: boolean;
}

/**
 * Gate a client page on a tenant permission (admins always pass via the
 * `admin:*` / `*:*` wildcard). Callers lacking it are redirected to /dashboard;
 * unauthenticated users are redirected to "/" by NextAuth's `required: true`.
 * Every gated page names the permission its backend route demands; there is
 * no admin-only gate any more, because a school can create its own lead
 * role (#3469). An array grants access when ANY of the
 * listed permissions is held (matching backend RequiresAnyPermission routes).
 * Where the backend rule is not a plain "any of these" — a required pair, for
 * example — pass the predicate that already states it (one shared rule instead
 * of a second, drifting spelling of it in the page).
 *
 * Usage:
 *   const { isReady } = useRequirePermission("users:update");
 *   const { isReady } = useRequirePermission(["display:read", "display:manage"]);
 *   const { isReady } = useRequirePermission(canReviewChangeRequests);
 *   if (!isReady) return <Loading />;
 */
export function useRequirePermission(
  permission:
    string | readonly string[] | ((session: Session | null) => boolean),
  { redirectWhenDenied = true }: UseRequirePermissionOptions = {},
): UseRequirePermissionReturn {
  const { data: session, status } = useSession({ required: true });
  const tenantPath = useTenantAwarePath();
  const allowed =
    typeof permission === "function"
      ? permission(session)
      : isAdmin(session) ||
        (typeof permission === "string" ? [permission] : permission).some((p) =>
          hasPermission(session, p),
        );

  const denied = status === "authenticated" && !allowed;
  if (denied && redirectWhenDenied) {
    redirect(tenantPath("/home"));
  }

  return {
    isReady: status === "authenticated" && allowed,
    isLoading: status === "loading",
    isDenied: denied,
  };
}
