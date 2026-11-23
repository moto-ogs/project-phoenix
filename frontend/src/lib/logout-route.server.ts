import "server-only";
import type { NextRequest } from "next/server";
import { contractWrite } from "~/lib/contract/client.server";
import { contractResponse } from "~/lib/contract/route-response.server";
import {
  handleApiError,
  problemResponse,
} from "~/lib/api-response-error.server";
import {
  renewalFailureResponse,
  renewSession,
} from "~/lib/backend-client.server";
import { createLogger } from "~/lib/logger";
import type { PortalAuth } from "~/server/auth/portal-auth";
import type { PortalDescriptor } from "~/server/auth/portals";
import type { ServerSession } from "~/server/auth/session-types";

const logger = createLogger({ component: "PortalLogoutRoute" });

function logoutToken(
  portal: PortalDescriptor,
  session: ServerSession | null,
): string | undefined {
  return portal.backend.logout.token === "access"
    ? session?.user?.token
    : session?.user?.refreshToken;
}

/**
 * A portal's BFF logout (#5194): revokes the session's refresh-token family,
 * so its access tokens end at once, also in a cookie a late response writes
 * back. The browser takes 401 for "nothing left to revoke" and then signs
 * out. A refused token may still belong to a live family (rotated by another
 * tab, or an expired access token), so the session is renewed once
 * (`renewSession`, for the token kind the portal's logout takes) and the
 * logout repeated with its token: a refused renewal answers 401; an
 * undecided one 503. The browser ends the session on the device for every
 * answer but success and 401, and the login page says the server may still
 * hold it (#7209).
 */
export function createLogoutRoute(
  session: Pick<PortalAuth, "portal" | "auth" | "uncachedAuth" | "withAuth">,
) {
  const { portal, auth, uncachedAuth } = session;
  const revoke = (request: NextRequest, token: string) =>
    contractWrite(portal.backend.logout.route, undefined, {
      token,
      request,
      timeout: "logout",
    });

  return session.withAuth(async (request: NextRequest) => {
    try {
      const token = logoutToken(portal, await auth());
      if (!token) return problemResponse(401, "No active session", request);

      const response = await revoke(request, token);
      if (response.ok || response.error.status !== 401) {
        return contractResponse(response, request);
      }
      const renewal = await renewSession({ uncachedAuth }, token, (renewed) =>
        logoutToken(portal, renewed),
      );
      if (renewal.outcome !== "renewed") {
        return renewalFailureResponse(renewal.outcome, request);
      }
      return contractResponse(await revoke(request, renewal.token), request);
    } catch (error) {
      logger.error("logout failed", {
        portal: portal.key,
        error: error instanceof Error ? error.message : String(error),
      });
      return handleApiError(error, request);
    }
  });
}
