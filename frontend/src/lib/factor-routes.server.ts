import "server-only";
import type { z } from "zod";
import {
  contractWrite,
  type ContractBody,
  type ContractOptions,
} from "~/lib/contract/client.server";
import { contractError } from "~/lib/contract/route-response.server";
import type { TokenResponse } from "~/lib/contract/shared.generated";
import type { SessionRenewed } from "~/lib/session-bff";
import { problemResponse } from "~/lib/api-response-error.server";
import { successResponse } from "~/lib/route-wrapper-utils.server";
import { installLoginSession } from "~/lib/login-route.server";
import { createLogger } from "~/lib/logger";
import type { makePortalHandlers } from "~/lib/portal-handlers.server";
import { captureBffException } from "~/lib/sentry-bff.server";
import type { PortalAuth } from "~/server/auth/portal-auth";
import { sessionMutationOriginError } from "~/server/auth/same-origin";

type FactorRoute = Parameters<typeof contractWrite>[0] & {
  method: "POST";
  routeFile: string;
  response: z.ZodType<TokenResponse>;
};

interface FactorConfirmRoute<R extends FactorRoute> {
  portal: Pick<PortalAuth, "portal" | "setSession" | "withAuth">;
  handlers: Pick<ReturnType<typeof makePortalHandlers>, "backendFetch">;
  /** The backend route that redeems the code and answers the new session. */
  route: R & (R["pattern"] extends `${string}{${string}` ? never : unknown);
  /** Why a backend 401 is not repeated with a renewed session. */
  retry: { off: string };
  log: { component: string; event: string };
}

/**
 * The BFF route that switches a voluntary second factor on (caterer #4497,
 * parents #7051). The backend answers with a new session with the second
 * factor proven; the BFF installs it, so no token reaches the browser
 * (#5005). When the code was right but the new session cannot be installed,
 * the answer says so: the second factor is on and the person must sign in
 * again.
 */
export function createFactorConfirmRoute<R extends FactorRoute>({
  portal,
  handlers,
  route,
  retry,
  log,
}: FactorConfirmRoute<R>) {
  const logger = createLogger({ component: log.component });
  return portal.withAuth(async (request) => {
    const originError = sessionMutationOriginError(request);
    if (originError) return originError;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return problemResponse(400, "Invalid JSON", request);
    }
    try {
      const reply = await contractWrite<R>(
        route,
        body as ContractBody<R>,
        ...([
          {
            send: (path, call) =>
              handlers.backendFetch(request, path, { ...call, retry }),
          },
        ] as ContractOptions<NoInfer<R>>),
      );
      if (!reply.ok) return contractError(reply, request);
      const failure = await installLoginSession(request, reply.value, portal);
      return Response.json(
        successResponse<SessionRenewed>({ session_renewed: failure === null }),
      );
    } catch (error) {
      captureBffException(error, request);
      logger.error(log.event, {
        error: error instanceof Error ? error.message : String(error),
      });
      return problemResponse(500, "MFA confirm unavailable", request);
    }
  });
}
