import "server-only";
import type { NextRequest } from "next/server";
import type { PortalDescriptor } from "~/server/auth/portals";
import { problemResponse } from "./api-response-error.server";
import { contractWrite } from "./contract/client.server";
import type { TokenResponse } from "./contract/shared.generated";
import { createLogger } from "./logger";
import { captureBffException } from "./sentry-bff.server";

const logger = createLogger({ component: "SessionTransition" });

/** A failed handoff never leaves its freshly minted family alive. */
export async function revokeMintedSession(
  revoke: () => ReturnType<typeof contractWrite>,
): Promise<void> {
  try {
    const reply = await revoke();
    if (!reply.ok) {
      logger.error("session_rollback_failed", { status: reply.error.status });
    }
  } catch (error) {
    logger.error("session_rollback_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Installs a backend-minted session through the portal's session writer.
 * Runs inside the portal's response wrapper, so the cookies leave through
 * mutateSession and then finishResponse, the write gate's order (#5399).
 * When installing fails, the minted family is revoked and the request
 * answers 500 without any of its credentials.
 */
export async function installMintedSession(
  request: NextRequest,
  install: () => Promise<void>,
  rollback: () => ReturnType<typeof contractWrite>,
): Promise<Response | null> {
  try {
    await install();
    return null;
  } catch (error) {
    logger.error("session_install_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    captureBffException(error, request);
    await revokeMintedSession(rollback);
    return problemResponse(500, "Session creation failed", request);
  }
}

/** The revocation of a minted pair: the token kind the portal's logout takes. */
export function logoutRollback(
  request: NextRequest,
  logout: PortalDescriptor["backend"]["logout"],
  pair: TokenResponse,
) {
  return () =>
    contractWrite(logout.route, undefined, {
      token: logout.token === "access" ? pair.access_token : pair.refresh_token,
      request,
      timeout: "session",
    });
}

/** A backend answer's token pair; anything else is an invalid answer. */
export function mintedPair(data: Partial<TokenResponse>): TokenResponse {
  const { access_token, refresh_token } = data;
  if (
    typeof access_token !== "string" ||
    !access_token ||
    typeof refresh_token !== "string" ||
    !refresh_token
  ) {
    throw new Error("Missing session credentials");
  }
  return { access_token, refresh_token };
}
