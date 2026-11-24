import { type NextRequest, NextResponse } from "next/server";
import { contractGet, type ContractReply } from "~/lib/contract/client.server";
import { routes } from "~/lib/contract/demo-access.generated";
import { createLogger } from "~/lib/logger";
import {
  handleApiError,
  problemResponse,
} from "~/lib/api-response-error.server";
import { forwardBackendResponse } from "~/lib/backend-proxy-response.server";
import { successResponse } from "~/lib/route-wrapper-utils.server";

const logger = createLogger({ component: "DemoAccessRoute" });

// Forwards a demo token to the backend (#3462). The token comes in the POST
// body and is never logged. A success answers `{ status, data }`, an error
// passes through unchanged.
export async function forwardDemoToken(
  request: NextRequest,
): Promise<NextResponse> {
  let token = "";
  try {
    const body = (await request.json()) as { token?: unknown };
    if (typeof body.token === "string") token = body.token;
  } catch {
    // An unreadable body is an unknown token.
  }
  if (!token) {
    return problemResponse(404, "demo access is unknown", request);
  }
  try {
    const reply = await contractGet(routes["GET /demo/access/status"], {
      token,
      request,
    });
    if (!reply.ok) return forwardDemoFailure(reply, request);
    return NextResponse.json(successResponse(reply.value), {
      status: reply.backend?.status,
    });
  } catch (error) {
    logger.error("demo_access_forward_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return problemResponse(500, "Internal Server Error", request);
  }
}

export function forwardDemoFailure(
  reply: Extract<ContractReply<unknown>, { ok: false }>,
  request: NextRequest,
): NextResponse {
  if (!reply.backend) throw reply.error.cause;
  if (reply.backend.ok) return handleApiError(reply.error.cause, request);
  return forwardBackendResponse(
    new Response(reply.error.cause.bodyText, {
      status: reply.backend.status,
      headers: reply.backend.headers,
    }),
    request,
  );
}

/**
 * Holds the demo token after the entry, so the banner can switch the demo
 * role (#3467) without the token ever being readable by a script. Only the
 * demo routes receive it, and it lives as long as a demo link.
 */
export const DEMO_TOKEN_COOKIE = "moto-demo-token";

export const DEMO_TOKEN_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
  path: "/api/demo",
  maxAge: 14 * 24 * 60 * 60,
} as const;
